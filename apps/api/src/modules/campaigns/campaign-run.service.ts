import { randomUUID } from "node:crypto";

import { createTextAdapter } from "@10xconnect/adapters";
import { env } from "@10xconnect/config";
import {
  applyRefinement,
  buildGenerationPrompt,
  deterministicGraph,
  type GenNode,
  parseGeneratedGraph,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  type EngineDeps,
  type EnrollResult,
  enrollLeads,
  leadVariables,
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

  /** Replace the campaign's graph. Only allowed while not running. */
  async saveSequence(
    workspaceId: string,
    campaignId: string,
    dto: SaveSequenceDto,
  ): Promise<{ nodes: SequenceNodeView[] }> {
    const campaign = await this.campaigns.getRowOr404(workspaceId, campaignId);
    if (campaign.status === "running") {
      throw new BadRequestException("Stop the campaign before editing its sequence.");
    }

    // Remap client ids → fresh uuids so edges stay consistent.
    const idMap = new Map<string, string>();
    for (const node of dto.nodes) {
      idMap.set(node.id, randomUUID());
    }
    const mapId = (id: string | null | undefined): string | null =>
      id ? (idMap.get(id) ?? null) : null;

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("sequence_nodes").where("campaign_id", "=", campaignId).execute();
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
    return this.getSequence(workspaceId, campaignId);
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
  ): Promise<{ nodes: GenNode[] }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);

    // Refinement: deterministic, reliable patches over the existing graph.
    if (dto.instruction && dto.currentGraph) {
      return { nodes: applyRefinement(dto.currentGraph as GenNode[], dto.instruction) };
    }

    const intake = dto.intake!;
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

  // --- Run / stop ----------------------------------------------------------

  async start(workspaceId: string, campaignId: string): Promise<{ status: string; scheduled: number }> {
    try {
      const { scheduled } = await startCampaign(this.engine, workspaceId, campaignId);
      return { status: "running", scheduled };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "Could not start campaign");
    }
  }

  async stop(workspaceId: string, campaignId: string): Promise<{ status: string }> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    await stopCampaign(this.engine, workspaceId, campaignId);
    return { status: "stopped" };
  }

  // --- Leads ---------------------------------------------------------------

  async enroll(workspaceId: string, campaignId: string, dto: EnrollLeadsDto): Promise<EnrollResult> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
    let leadIds = dto.leadIds ?? [];
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
      throw new BadRequestException("No leads to enroll.");
    }
    return enrollLeads(this.engine, workspaceId, campaignId, leadIds);
  }

  async listLeads(workspaceId: string, campaignId: string): Promise<CampaignLeadView[]> {
    await this.campaigns.getRowOr404(workspaceId, campaignId);
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
        "n.type as currentNodeType",
      ])
      .where("lcs.workspace_id", "=", workspaceId)
      .where("lcs.campaign_id", "=", campaignId)
      .orderBy("lcs.created_at", "asc")
      .execute();

    return rows.map((r) => {
      const e = (r.enrichment ?? {}) as Record<string, unknown>;
      const name =
        [e.firstName, e.lastName].filter(Boolean).join(" ").trim() ||
        (typeof r.email === "string" ? r.email : "") ||
        (typeof r.linkedinUrl === "string" ? r.linkedinUrl : "") ||
        "Lead";
      return {
        leadId: r.leadId,
        name,
        status: r.status,
        currentNodeType: r.currentNodeType ?? null,
        updatedAt: r.updatedAt,
      };
    });
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
