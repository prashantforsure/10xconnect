// Campaign duplicate + A/B comparison (Phase 7.2). Duplicate clones a campaign's
// STRUCTURE (graph + brain config + cadence + settings + account binding) into a
// fresh DRAFT campaign with 0 contacts — the seam for "swap the list" A/B avatar
// testing: clone, enroll a DIFFERENT list, run both, compare results side by side.
// Unlike a workflow template, a duplicate stays IN-workspace and keeps the account/
// KB/voice bindings (same persona, different audience).

import { randomUUID } from "node:crypto";

import type { DB, Json } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { computeUnitEconomics } from "./unit-economics";

// jsonb columns are re-serialized on insert (pg wants text for jsonb); plain
// id columns (account/kb/voice) pass through.
const JSONB_COLS = [
  "caps",
  "schedule",
  "settings",
  "objective",
  "guardrails",
  "voice",
  "autonomy",
  "limits",
  "budget",
] as const;
const ID_COLS = ["account_id", "knowledge_base_id", "voice_profile_id"] as const;

function jsonbOrNull(value: unknown): Json | null {
  return value == null ? null : (JSON.stringify(value) as unknown as Json);
}

export interface DuplicateResult {
  campaignId: string;
  nodeCount: number;
}

/**
 * Duplicate a campaign's structure into a fresh DRAFT campaign with 0 contacts.
 * Keeps the account/KB/voice bindings + brain config + cadence; clones the node
 * graph with fresh ids (edges preserved). Returns null if not found in workspace.
 */
export async function duplicateCampaign(
  db: Kysely<DB>,
  input: { workspaceId: string; campaignId: string; name?: string },
): Promise<DuplicateResult | null> {
  const src = await db
    .selectFrom("campaigns")
    .select(["id", "name", ...JSONB_COLS, ...ID_COLS])
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.campaignId)
    .executeTakeFirst();
  if (!src) return null;

  const nodes = await db
    .selectFrom("sequence_nodes")
    .select(["id", "kind", "type", "config", "next_node_id", "true_node_id", "false_node_id", "delay_days"])
    .where("workspace_id", "=", input.workspaceId)
    .where("campaign_id", "=", input.campaignId)
    .orderBy("created_at", "asc")
    .execute();

  return db.transaction().execute(async (trx) => {
    const row = src as Record<string, unknown>;
    const campaign = await trx
      .insertInto("campaigns")
      .values({
        workspace_id: input.workspaceId,
        name: input.name?.trim() || `${src.name} (copy)`,
        status: "draft",
        account_id: src.account_id ?? null,
        knowledge_base_id: src.knowledge_base_id ?? null,
        voice_profile_id: src.voice_profile_id ?? null,
        caps: jsonbOrNull(row.caps),
        schedule: jsonbOrNull(row.schedule),
        settings: jsonbOrNull(row.settings),
        objective: jsonbOrNull(row.objective),
        guardrails: jsonbOrNull(row.guardrails),
        voice: jsonbOrNull(row.voice),
        autonomy: jsonbOrNull(row.autonomy),
        limits: jsonbOrNull(row.limits),
        budget: jsonbOrNull(row.budget),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const idMap = new Map<string, string>();
    for (const n of nodes) idMap.set(n.id, randomUUID());
    const mapId = (id: string | null): string | null => (id ? (idMap.get(id) ?? null) : null);

    if (nodes.length > 0) {
      await trx
        .insertInto("sequence_nodes")
        .values(
          nodes.map((n) => ({
            id: idMap.get(n.id) as string,
            workspace_id: input.workspaceId,
            campaign_id: campaign.id,
            kind: n.kind,
            type: n.type,
            config: JSON.stringify(n.config ?? {}) as unknown as Json,
            next_node_id: mapId(n.next_node_id),
            true_node_id: mapId(n.true_node_id),
            false_node_id: mapId(n.false_node_id),
            delay_days: n.delay_days ?? null,
          })),
        )
        .execute();
    }

    return { campaignId: campaign.id, nodeCount: nodes.length };
  });
}

// --- A/B comparison --------------------------------------------------------

export interface CampaignOutcome {
  campaignId: string;
  name: string;
  enrolled: number;
  sent: number;
  accepted: number;
  replied: number;
  /** sent that resulted in an accepted invite, as a %. */
  acceptRate: number;
  replyRate: number;
  // Unit economics folded in (Phase 7.5) — the A/B avatar profitability readout.
  /** All-time AI spend attributed to this campaign (budget_ledger). */
  spendUsd: number;
  /** Conversations attributed to this campaign (via lead_campaign_state). */
  conversations: number;
  /** Booked meetings (conversations in the `booked` pipeline stage). */
  bookedMeetings: number;
  /** spend ÷ conversations (null until there's a conversation). */
  costPerConversationUsd: number | null;
  /** spend ÷ booked meetings — the headline A/B number. */
  costPerBookedMeetingUsd: number | null;
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/**
 * Side-by-side outcome metrics for two (or more) campaigns — the A/B readout after
 * a clone + list swap. All real: enrolled (lead_campaign_state), sent (successful
 * actions), accepted (invite_accepted events), replied (replied state).
 */
export async function campaignAbComparison(
  db: Kysely<DB>,
  input: { workspaceId: string; campaignIds: string[] },
): Promise<CampaignOutcome[]> {
  const ids = input.campaignIds;
  if (ids.length === 0) return [];

  const campaigns = await db
    .selectFrom("campaigns")
    .select(["id", "name"])
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "in", ids)
    .execute();

  const stateRows = await db
    .selectFrom("lead_campaign_state")
    .select((eb) => ["campaign_id", "status", eb.fn.countAll<string>().as("count")])
    .where("workspace_id", "=", input.workspaceId)
    .where("campaign_id", "in", ids)
    .groupBy(["campaign_id", "status"])
    .execute();

  const sentRows = await db
    .selectFrom("actions")
    .select((eb) => ["campaign_id", eb.fn.countAll<string>().as("count")])
    .where("workspace_id", "=", input.workspaceId)
    .where("status", "=", "success")
    .where("campaign_id", "in", ids)
    .groupBy("campaign_id")
    .execute();

  const acceptedRows = await db
    .selectFrom("lead_events as le")
    .innerJoin("lead_campaign_state as lcs", (join) =>
      join.onRef("lcs.lead_id", "=", "le.lead_id").onRef("lcs.workspace_id", "=", "le.workspace_id"),
    )
    .select((eb) => ["lcs.campaign_id as campaign_id", eb.fn.count<string>("le.lead_id").distinct().as("count")])
    .where("le.workspace_id", "=", input.workspaceId)
    .where("le.type", "=", "invite_accepted")
    .where("lcs.campaign_id", "in", ids)
    .groupBy("lcs.campaign_id")
    .execute();

  const enrolled = new Map<string, number>();
  const replied = new Map<string, number>();
  for (const r of stateRows) {
    const c = Number(r.count);
    enrolled.set(r.campaign_id, (enrolled.get(r.campaign_id) ?? 0) + c);
    if (r.status === "replied") replied.set(r.campaign_id, (replied.get(r.campaign_id) ?? 0) + c);
  }
  const sent = new Map(sentRows.map((r) => [r.campaign_id as string, Number(r.count)]));
  const accepted = new Map(acceptedRows.map((r) => [r.campaign_id as string, Number(r.count)]));

  // Per-campaign unit economics (all-time, to match the lifetime funnel above).
  const econ = new Map(
    await Promise.all(
      ids.map(
        async (id) =>
          [id, await computeUnitEconomics(db, { workspaceId: input.workspaceId, campaignId: id })] as const,
      ),
    ),
  );

  return ids.map((id) => {
    const s = sent.get(id) ?? 0;
    const a = accepted.get(id) ?? 0;
    const rep = replied.get(id) ?? 0;
    const e = econ.get(id);
    return {
      campaignId: id,
      name: campaigns.find((c) => c.id === id)?.name ?? "",
      enrolled: enrolled.get(id) ?? 0,
      sent: s,
      accepted: a,
      replied: rep,
      acceptRate: pct(a, s),
      replyRate: pct(rep, s),
      spendUsd: e?.totalSpendUsd ?? 0,
      conversations: e?.conversations ?? 0,
      bookedMeetings: e?.bookedMeetings ?? 0,
      costPerConversationUsd: e?.costPerConversationUsd ?? null,
      costPerBookedMeetingUsd: e?.costPerBookedMeetingUsd ?? null,
    };
  });
}
