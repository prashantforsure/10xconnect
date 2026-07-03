import { randomUUID } from "node:crypto";

import { createTextAdapter } from "@10xconnect/adapters";
import { env } from "@10xconnect/config";
import {
  applyRefinement,
  buildBlueprintPrompt,
  buildGenerationPrompt,
  type CampaignBlueprint,
  clarifyingQuestions,
  deterministicBlueprint,
  deterministicGraph,
  type GenNode,
  type GraphIssue,
  parseBlueprint,
  parseGeneratedGraph,
  validateSequenceGraph,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  type CampaignOutcome,
  campaignAbComparison,
  type DuplicateResult,
  duplicateCampaign,
  type EngineDeps,
  type EnrollResult,
  enrollLeads,
  leadVariables,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
  stopCampaign,
} from "@10xconnect/engine";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { KYSELY_DB } from "../../database/database.module";
import { ENGINE_DEPS } from "../../engine/engine.module";

import { CampaignsService } from "./campaigns.service";
import type { EnrollLeadsDto, GenerateCampaignDto, SaveSequenceDto } from "./dto";

export interface SequenceNodeView {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
  next: string | null;
  true: string | null;
  false: string | null;
  delayDays: number | null;
}

export interface CampaignLeadView {
  leadId: string;
  name: string;
  avatarUrl: string | null;
  title: string | null;
  company: string | null;
  headline: string | null;
  location: string | null;
  linkedinUrl: string | null;
  email: string | null;
  connectionDegree: string | null;
  status: string;
  currentNodeType: string | null;
  updatedAt: string;
}

export interface PreviewSampleView {
  leadId: string;
  name: string;
  vars: Record<string, string>;
}

// Lead columns needed to build composer preview variables (mirrors engine LeadRow).
const LEAD_VAR_COLUMNS = [
  "l.id as id",
  "l.workspace_id as workspace_id",
  "l.linkedin_url as linkedin_url",
  "l.email as email",
  "l.enrichment as enrichment",
  "l.tags as tags",
  "l.custom_columns as custom_columns",
  "l.connection_degree as connection_degree",
] as const;

@Injectable()
export class CampaignRunService {
  private readonly logger = new Logger(CampaignRunService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(ENGINE_DEPS) private readonly engine: EngineDeps,
    private readonly campaigns: CampaignsService,
  ) {}

  // --- Sequence graph ------------------------------------------------------

  async getSequence(workspaceId: string, campaignId: string): Promise<{ nodes: SequenceNodeView[] }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    const rows = await this.db
      .selectFrom("sequence_nodes")
      .select(["id", "kind", "type", "config", "next_node_id", "true_node_id", "false_node_id", "delay_days"])
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .orderBy("created_at", "asc")
      .execute();
    return {
      nodes: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        type: r.type,
        config: (r.config ?? {}) as Record<string, unknown>,
        next: r.next_node_id,
        true: r.true_node_id,
        false: r.false_node_id,
        delayDays: r.delay_days,
      })),
    };
  }

  /**
   * Replace the campaign's graph. While the campaign is live (running/paused),
   * only in-place CONTENT updates are accepted (same nodes/edges, new config or
   * wait durations); structural changes require stopping the campaign first.
   */
  async saveSequence(
    workspaceId: string,
    campaignId: string,
    dto: SaveSequenceDto,
  ): Promise<{ nodes: SequenceNodeView[]; warnings?: GraphIssue[] }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);

    // Reject graphs the engine can't execute safely (cycles, dangling refs,
    // unknown/email node types, disconnected chains) BEFORE touching the DB.
    const validation = validateSequenceGraph(
      dto.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        type: n.type,
        next: n.next ?? null,
        true: n.true ?? null,
        false: n.false ?? null,
      })),
    );
    if (!validation.ok) {
      throw new BadRequestException({
        message: validation.errors.map((e) => e.message).join(" "),
        errors: validation.errors,
      });
    }

    // Remap client ids → fresh uuids so edges stay consistent.
    const idMap = new Map<string, string>();
    for (const node of dto.nodes) {
      idMap.set(node.id, randomUUID());
    }
    const mapId = (id: string | null | undefined): string | null =>
      id ? (idMap.get(id) ?? null) : null;

    await this.db.transaction().execute(async (trx) => {
      // Row-lock the campaign and re-check status INSIDE the transaction: a
      // start landing between a naive check and the node swap would leave
      // running leads pointing at deleted nodes (check-then-act race). With the
      // lock, start either waits for this commit (and reads the new graph) or
      // wins first (and this save rejects).
      const row = await trx
        .selectFrom("campaigns")
        .select(["id", "status"])
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", campaignId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) {
        throw new NotFoundException("Campaign not found");
      }
      // Both running AND paused have leads parked on nodes; a destructive
      // delete+reinsert (fresh ids) would strand them. While live, CONTENT edits
      // (message bodies, notes, wait durations) are still allowed via an in-place
      // config update — but only when the structure (node set, types, edges) is
      // byte-identical to what's stored. Anything structural requires a stop.
      if (row.status === "running" || row.status === "paused") {
        const existing = await trx
          .selectFrom("sequence_nodes")
          .select(["id", "kind", "type", "next_node_id", "true_node_id", "false_node_id"])
          .where("workspace_id", "=", workspaceId)
          .where("campaign_id", "=", campaignId)
          .execute();
        const current = new Map(existing.map((n) => [n.id, n]));
        const structureUnchanged =
          dto.nodes.length === existing.length &&
          dto.nodes.every((n) => {
            const cur = current.get(n.id);
            return (
              cur !== undefined &&
              cur.kind === n.kind &&
              cur.type === n.type &&
              (cur.next_node_id ?? null) === (n.next ?? null) &&
              (cur.true_node_id ?? null) === (n.true ?? null) &&
              (cur.false_node_id ?? null) === (n.false ?? null)
            );
          });
        if (!structureUnchanged) {
          throw new BadRequestException(
            "The campaign is live — message content and wait times save automatically, but stop the campaign to add, remove, reorder, or change steps.",
          );
        }
        for (const node of dto.nodes) {
          await trx
            .updateTable("sequence_nodes")
            .set({
              config: JSON.stringify(node.config ?? {}),
              delay_days: node.delayDays ?? null,
            })
            .where("workspace_id", "=", workspaceId)
            .where("campaign_id", "=", campaignId)
            .where("id", "=", node.id)
            .execute();
        }
        return;
      }
      await trx
        .deleteFrom("sequence_nodes")
        .where("workspace_id", "=", workspaceId)
        .where("campaign_id", "=", campaignId)
        .execute();
      if (dto.nodes.length === 0) {
        return;
      }
      await trx
        .insertInto("sequence_nodes")
        .values(
          dto.nodes.map((node) => ({
            id: idMap.get(node.id) as string,
            workspace_id: workspaceId,
            campaign_id: campaignId,
            kind: node.kind,
            type: node.type,
            config: JSON.stringify(node.config ?? {}),
            next_node_id: mapId(node.next),
            true_node_id: mapId(node.true),
            false_node_id: mapId(node.false),
            delay_days: node.delayDays ?? null,
          })),
        )
        .execute();
    });

    this.logger.log(`Saved sequence for campaign ${campaignId} (${dto.nodes.length} nodes)`);
    const saved = await this.getSequence(workspaceId, campaignId);
    return validation.warnings.length > 0 ? { ...saved, warnings: validation.warnings } : saved;
  }

  /** Per-node lead counts (lead_campaign_state grouped by current_node_id). */
  async nodeCounts(workspaceId: string, campaignId: string): Promise<Record<string, number>> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    const rows = await this.db
      .selectFrom("lead_campaign_state")
      .select(["current_node_id"])
      .select((eb) => eb.fn.count("lead_id").as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("current_node_id", "is not", null)
      .groupBy("current_node_id")
      .execute();
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.current_node_id) {
        out[r.current_node_id] = Number(r.count);
      }
    }
    return out;
  }

  /**
   * Per-node + campaign-summary stats for the builder's connector stat chips.
   * Everything is real (from lead_campaign_state + actions + leads) and mock-safe
   * — zeros/empty before a campaign has run. `leads` = leads parked at the node;
   * `done`/`failed` = executed transport actions for the node.
   */
  async nodeStats(
    workspaceId: string,
    campaignId: string,
  ): Promise<{
    summary: { leads: number; enrichedPct: number };
    nodes: Record<string, { leads: number; done: number; failed: number }>;
  }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);

    // Leads parked at each node + total enrolled.
    const stateRows = await this.db
      .selectFrom("lead_campaign_state")
      .select(["current_node_id"])
      .select((eb) => eb.fn.count("lead_id").as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .groupBy("current_node_id")
      .execute();

    const nodes: Record<string, { leads: number; done: number; failed: number }> = {};
    let totalLeads = 0;
    for (const r of stateRows) {
      const c = Number(r.count);
      totalLeads += c;
      if (r.current_node_id) {
        nodes[r.current_node_id] = { leads: c, done: 0, failed: 0 };
      }
    }

    // Executed actions per node (success vs failed).
    const actionRows = await this.db
      .selectFrom("actions")
      .select(["node_id", "status"])
      .select((eb) => eb.fn.count("id").as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("node_id", "is not", null)
      .where("status", "in", ["success", "failed"])
      .groupBy(["node_id", "status"])
      .execute();
    for (const r of actionRows) {
      if (!r.node_id) {
        continue;
      }
      const bucket = (nodes[r.node_id] ??= { leads: 0, done: 0, failed: 0 });
      if (r.status === "success") bucket.done += Number(r.count);
      else bucket.failed += Number(r.count);
    }

    // Enriched fraction across enrolled leads (drives "N leads · X% enriched").
    const enrichRow = await this.db
      .selectFrom("lead_campaign_state as lcs")
      .innerJoin("leads as l", "l.id", "lcs.lead_id")
      .select((eb) => [
        eb.fn.countAll<string>().as("total"),
        eb.fn
          .count<string>("l.id")
          .filterWhere("l.enrich_status", "=", "enriched")
          .as("enriched"),
      ])
      .where("lcs.workspace_id", "=", workspaceId)
      .where("lcs.campaign_id", "=", campaignId)
      .executeTakeFirst();
    const enrolled = Number(enrichRow?.total ?? 0);
    const enriched = Number(enrichRow?.enriched ?? 0);
    const enrichedPct = enrolled > 0 ? Math.round((enriched / enrolled) * 100) : 0;

    return { summary: { leads: totalLeads, enrichedPct }, nodes };
  }

  /** Up to `limit` sample leads with rendered variables for the composer Preview. */
  async previewSamples(
    workspaceId: string,
    campaignId: string,
    limit = 3,
  ): Promise<PreviewSampleView[]> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    // Prefer leads enrolled in this campaign; fall back to any workspace lead.
    let rows = await this.db
      .selectFrom("lead_campaign_state as lcs")
      .innerJoin("leads as l", "l.id", "lcs.lead_id")
      .select(LEAD_VAR_COLUMNS)
      .where("lcs.workspace_id", "=", workspaceId)
      .where("lcs.campaign_id", "=", campaignId)
      .orderBy("lcs.created_at", "asc")
      .limit(limit)
      .execute();
    if (rows.length === 0) {
      rows = await this.db
        .selectFrom("leads as l")
        .select(LEAD_VAR_COLUMNS)
        .where("l.workspace_id", "=", workspaceId)
        .orderBy("l.created_at", "desc")
        .limit(limit)
        .execute();
    }
    return rows.map((r) => {
      const vars = leadVariables({
        id: r.id,
        workspace_id: r.workspace_id,
        linkedin_url: r.linkedin_url,
        email: r.email,
        enrichment: r.enrichment,
        tags: r.tags ?? [],
        custom_columns: r.custom_columns ?? {},
        connection_degree: r.connection_degree,
      });
      const e = (r.enrichment ?? {}) as Record<string, unknown>;
      const name =
        [e.firstName, e.lastName].filter(Boolean).join(" ").trim() ||
        (typeof r.email === "string" ? r.email : "") ||
        "Lead";
      return { leadId: r.id, name, vars };
    });
  }

  // --- AI campaign generator (E4) ------------------------------------------

  private readonly text = createTextAdapter();

  /**
   * Generate (or refine) a sequence graph from natural language. Returns an
   * editable graph — NEVER saves or launches. Output is always validated/clamped
   * to the known node types with safety enforced (core campaign-gen). Mock-safe:
   * with no LLM the deterministic generator is used.
   */
  async generate(
    workspaceId: string,
    campaignId: string,
    dto: GenerateCampaignDto,
  ): Promise<{ nodes: GenNode[] } | { questions: string[] } | { blueprint: CampaignBlueprint }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);

    // Refinement: deterministic, reliable patches over the existing graph.
    if (dto.instruction && dto.currentGraph) {
      return { nodes: applyRefinement(dto.currentGraph as GenNode[], dto.instruction) };
    }

    const intake = dto.intake;
    if (!intake) {
      throw new BadRequestException("Provide an intake to generate a campaign.");
    }

    // Phase 6: a FULL campaign blueprint (graph + brain + KB seed). If the intake
    // is under-specified, ask 1–2 clarifying questions FIRST (unless skipped), so
    // the campaign isn't built on guesses. NEVER saves or launches.
    if (dto.full) {
      const questions = clarifyingQuestions(intake);
      if (questions.length > 0 && !dto.skipClarify) {
        return { questions };
      }
      if (this.text) {
        try {
          const { system, prompt } = buildBlueprintPrompt(intake);
          const raw = await this.text.generate({ prompt, system, maxTokens: 1600, temperature: 0.6 });
          return { blueprint: parseBlueprint(raw, intake) };
        } catch {
          // fall through to the deterministic blueprint
        }
      }
      return { blueprint: deterministicBlueprint(intake) };
    }

    if (this.text) {
      try {
        const { system, prompt } = buildGenerationPrompt(intake);
        const raw = await this.text.generate({ prompt, system, maxTokens: 1200, temperature: 0.6 });
        return { nodes: parseGeneratedGraph(raw, intake) };
      } catch {
        // fall through to the deterministic generator
      }
    }
    return { nodes: deterministicGraph(intake) };
  }

  // --- Duplicate + A/B comparison (Phase 7.2) ------------------------------

  /** Clone a campaign's structure into a fresh draft (0 contacts) for list-swap A/B. */
  async duplicate(
    workspaceId: string,
    campaignId: string,
    name?: string,
  ): Promise<DuplicateResult> {
    const res = await duplicateCampaign(this.db, { workspaceId, campaignId, name });
    if (!res) throw new NotFoundException("Campaign not found");
    return res;
  }

  /** Side-by-side outcome metrics for an A/B set (clone + swapped list). */
  abCompare(workspaceId: string, campaignIds: string[]): Promise<CampaignOutcome[]> {
    return campaignAbComparison(this.db, { workspaceId, campaignIds });
  }

  // --- Run / stop ----------------------------------------------------------

  /** When the campaign's earliest pending action fires ("your first action ~2:06 PM"). */
  private async nextPendingAt(workspaceId: string, campaignId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom("actions")
      .select("scheduled_at")
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "pending")
      .orderBy("scheduled_at", "asc")
      .limit(1)
      .executeTakeFirst();
    return row?.scheduled_at ? new Date(row.scheduled_at).toISOString() : null;
  }

  /**
   * The campaign's dispatch queue, soonest first — the forward-looking answer to
   * "is it working?" that the past-actions log can't give.
   */
  async upcoming(
    workspaceId: string,
    campaignId: string,
    limit = 10,
  ): Promise<{ total: number; actions: { type: string; at: string | null; lead: string }[] }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    const totalRow = await this.db
      .selectFrom("actions")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "pending")
      .executeTakeFirst();
    const rows = await this.db
      .selectFrom("actions as a")
      .leftJoin("leads as l", "l.id", "a.lead_id")
      .select(["a.type as type", "a.scheduled_at as at", "l.enrichment as enrichment", "l.email as email"])
      .where("a.workspace_id", "=", workspaceId)
      .where("a.campaign_id", "=", campaignId)
      .where("a.status", "=", "pending")
      .orderBy("a.scheduled_at", "asc")
      .limit(Math.min(Math.max(1, Math.floor(limit)), 50))
      .execute();
    return {
      total: Number(totalRow?.count ?? 0),
      actions: rows.map((r) => {
        const e = (r.enrichment ?? {}) as Record<string, unknown>;
        const lead =
          [e.firstName, e.lastName].filter(Boolean).join(" ").trim() ||
          (typeof r.email === "string" ? r.email : "") ||
          "Lead";
        return { type: r.type, at: r.at ? new Date(r.at).toISOString() : null, lead };
      }),
    };
  }

  async start(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ status: string; scheduled: number; nextActionAt: string | null }> {
    try {
      const { scheduled } = await startCampaign(this.engine, workspaceId, campaignId);
      const nextActionAt = await this.nextPendingAt(workspaceId, campaignId);
      return { status: "running", scheduled, nextActionAt };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "Could not start campaign");
    }
  }

  async stop(workspaceId: string, campaignId: string): Promise<{ status: string }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    await stopCampaign(this.engine, workspaceId, campaignId);
    return { status: "stopped" };
  }

  /** Freeze a running campaign in place (resumable). */
  async pause(workspaceId: string, campaignId: string): Promise<{ status: string }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    try {
      await pauseCampaign(this.engine, workspaceId, campaignId);
      return { status: "paused" };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "Could not pause campaign");
    }
  }

  /** Resume a paused campaign, re-scheduling each lead from where it stopped. */
  async resume(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ status: string; scheduled: number; nextActionAt: string | null }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    try {
      const { scheduled } = await resumeCampaign(this.engine, workspaceId, campaignId);
      const nextActionAt = await this.nextPendingAt(workspaceId, campaignId);
      return { status: "running", scheduled, nextActionAt };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "Could not resume campaign");
    }
  }

  // --- Leads ---------------------------------------------------------------

  async enroll(workspaceId: string, campaignId: string, dto: EnrollLeadsDto): Promise<EnrollResult> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    let leadIds = dto.leadIds ?? [];
    if (dto.allContacts) {
      const rows = await this.db
        .selectFrom("leads")
        .select("id")
        .where("workspace_id", "=", workspaceId)
        .execute();
      leadIds = [...new Set([...leadIds, ...rows.map((r) => r.id)])];
    }
    if (dto.listId) {
      const rows = await this.db
        .selectFrom("list_leads")
        .select("lead_id")
        .where("workspace_id", "=", workspaceId)
        .where("list_id", "=", dto.listId)
        .execute();
      leadIds = [...new Set([...leadIds, ...rows.map((r) => r.lead_id)])];
    }
    if (leadIds.length === 0) {
      throw new BadRequestException(
        dto.allContacts
          ? "You have no contacts yet. Import contacts first, then enroll them."
          : "That list has no contacts. Add contacts to it, or import new leads.",
      );
    }
    return enrollLeads(this.engine, workspaceId, campaignId, leadIds);
  }

  async listLeads(
    workspaceId: string,
    campaignId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ leads: CampaignLeadView[]; total: number }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    // Paginated so a 10k-lead campaign doesn't ship every row on tab open.
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), 200);
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));

    const totalRow = await this.db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .executeTakeFirst();
    const total = Number(totalRow?.count ?? 0);

    const rows = await this.db
      .selectFrom("lead_campaign_state as lcs")
      .innerJoin("leads as l", "l.id", "lcs.lead_id")
      .leftJoin("sequence_nodes as n", "n.id", "lcs.current_node_id")
      .select([
        "lcs.lead_id as leadId",
        "lcs.status as status",
        "lcs.updated_at as updatedAt",
        "l.linkedin_url as linkedinUrl",
        "l.email as email",
        "l.enrichment as enrichment",
        "l.connection_degree as connectionDegree",
        "n.type as currentNodeType",
      ])
      .where("lcs.workspace_id", "=", workspaceId)
      .where("lcs.campaign_id", "=", campaignId)
      .orderBy("lcs.created_at", "asc")
      .limit(limit)
      .offset(offset)
      .execute();

    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    // 1 → "1st", 2 → "2nd", 3 → "3rd" (LinkedIn connection degree).
    const degree = (v: unknown): string | null => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1) {
        return null;
      }
      const suffix = v === 1 ? "st" : v === 2 ? "nd" : v === 3 ? "rd" : "th";
      return `${v}${suffix}`;
    };

    const leads = rows.map((r) => {
      const e = (r.enrichment ?? {}) as Record<string, unknown>;
      const name =
        [e.firstName, e.lastName].filter(Boolean).join(" ").trim() ||
        (typeof r.email === "string" ? r.email : "") ||
        (typeof r.linkedinUrl === "string" ? r.linkedinUrl : "") ||
        "Lead";
      return {
        leadId: r.leadId,
        name,
        avatarUrl: str(e.avatarUrl),
        title: str(e.role) ?? str(e.jobTitle),
        company: str(e.company) ?? str(e.companyName),
        headline: str(e.headline),
        location: str(e.location),
        linkedinUrl: str(r.linkedinUrl),
        email: str(r.email),
        connectionDegree: degree(r.connectionDegree),
        status: r.status,
        currentNodeType: r.currentNodeType ?? null,
        updatedAt: r.updatedAt,
      };
    });
    return { leads, total };
  }

  async removeLead(
    workspaceId: string,
    campaignId: string,
    leadId: string,
  ): Promise<{ removed: true }> {
    await this.db
      .updateTable("actions")
      .set({ status: "skipped" })
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("lead_id", "=", leadId)
      .where("status", "=", "pending")
      .execute();
    const deleted = await this.db
      .deleteFrom("lead_campaign_state")
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("lead_id", "=", leadId)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Lead is not in this campaign");
    }
    return { removed: true };
  }

  async leadStage(workspaceId: string, campaignId: string, leadId: string) {
    const row = await this.db
      .selectFrom("lead_campaign_state as lcs")
      .leftJoin("sequence_nodes as n", "n.id", "lcs.current_node_id")
      .select([
        "lcs.status as status",
        "lcs.current_node_id as currentNodeId",
        "lcs.history as history",
        "n.type as currentNodeType",
      ])
      .where("lcs.workspace_id", "=", workspaceId)
      .where("lcs.campaign_id", "=", campaignId)
      .where("lcs.lead_id", "=", leadId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException("Lead is not in this campaign");
    }
    return {
      status: row.status,
      currentNodeId: row.currentNodeId,
      currentNodeType: row.currentNodeType ?? null,
      history: row.history ?? [],
    };
  }

  // --- Share ---------------------------------------------------------------

  async share(workspaceId: string, campaignId: string): Promise<{ shareToken: string; url: string }> {
    const campaign = await this.campaigns.getRowOr404(workspaceId, campaignId);
    let token = campaign.share_token;
    if (!token) {
      token = randomUUID().replace(/-/g, "");
      await this.db
        .updateTable("campaigns")
        .set({ share_token: token })
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", campaignId)
        .execute();
    }
    return { shareToken: token, url: `${env.APP_URL}/shared/campaigns/${token}` };
  }
}
