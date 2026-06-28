// Campaign lifecycle + per-lead graph progression. enroll/start/stop create
// lead_campaign_state and the first due action; advanceLead moves a lead to its
// next node and schedules that node's action (respecting wait_x_days, working
// hours, and ~6-min jitter). The worker tick executes the scheduled actions.

import { autonomyFrom, computeFirstDispatchAt, computeNextDispatchAt } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { isConditionType, nodeToActionType } from "./nodes";
import { loadGraph } from "./repository";
import { isLeadSuppressed } from "./suppression";
import type { EngineDeps, HistoryEntry, LeadStateRow, SequenceNodeRow } from "./types";

const DAY_MS = 86_400_000;

function now(deps: EngineDeps): Date {
  return deps.now?.() ?? new Date();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function historyOf(state: LeadStateRow): HistoryEntry[] {
  return Array.isArray(state.history) ? (state.history as unknown as HistoryEntry[]) : [];
}

function waitDays(node: SequenceNodeRow): number {
  const cfg = asObject(node.config);
  const fromCfg = typeof cfg.days === "number" ? cfg.days : undefined;
  const days = fromCfg ?? node.delay_days ?? 1;
  return Math.max(0, days);
}

/** The next node id given how a node resolved (condition → true/false branch). */
export function nextNodeId(node: SequenceNodeRow, outcome: "next" | "true" | "false"): string | null {
  if (outcome === "true") {
    return node.true_node_id;
  }
  if (outcome === "false") {
    return node.false_node_id;
  }
  return node.next_node_id;
}

interface CampaignRow {
  id: string;
  workspace_id: string;
  status: string;
  account_id: string | null;
  schedule: unknown;
  settings: unknown;
}

async function getCampaign(
  db: Kysely<DB>,
  workspaceId: string,
  campaignId: string,
): Promise<CampaignRow | undefined> {
  return (await db
    .selectFrom("campaigns")
    .select(["id", "workspace_id", "status", "account_id", "schedule", "settings"])
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", campaignId)
    .executeTakeFirst()) as CampaignRow | undefined;
}

function parseSchedule(value: unknown): import("@10xconnect/core").WeekSchedule {
  // Lazy import-free: the stored shape already matches WeekSchedule; fall back to
  // a permissive cast (validated on save in the campaigns service).
  return value as import("@10xconnect/core").WeekSchedule;
}

/**
 * Create one pending action row for a node (the durable dispatch-queue entry).
 * idempotency_key includes stepSeq so loop iterations are distinct while retries
 * of the same step reuse the key (no double-send).
 */
async function scheduleNodeAction(
  deps: EngineDeps,
  campaign: CampaignRow,
  state: LeadStateRow,
  node: SequenceNodeRow,
  scheduledAt: Date,
  stepSeq: number,
): Promise<void> {
  await deps.db
    .insertInto("actions")
    .values({
      workspace_id: state.workspace_id,
      account_id: campaign.account_id,
      lead_id: state.lead_id,
      campaign_id: campaign.id,
      node_id: node.id,
      // Store the transport ActionType for transport nodes (so the rate governor
      // aggregates per action type + analytics map to §7); the node type for
      // conditions/orchestration (which the governor ignores).
      type: nodeToActionType(node.type) ?? node.type,
      status: "pending",
      config: JSON.stringify(asObject(node.config)),
      idempotency_key: `${campaign.id}:${state.lead_id}:${node.id}:${stepSeq}`,
      scheduled_at: scheduledAt.toISOString(),
    })
    .onConflict((oc) => oc.column("idempotency_key").doNothing())
    .execute();
}

/** Skip past wait_x_days nodes, accumulating their delay; returns the real next. */
function resolveWaitChain(
  startId: string | null,
  byId: Map<string, SequenceNodeRow>,
): { node: SequenceNodeRow | null; extraMs: number } {
  let id = startId;
  let extraMs = 0;
  for (let guard = 0; guard < 200 && id; guard += 1) {
    const node = byId.get(id);
    if (!node) {
      return { node: null, extraMs };
    }
    if (node.type === "wait_x_days") {
      extraMs += waitDays(node) * DAY_MS;
      id = node.next_node_id;
      continue;
    }
    return { node, extraMs };
  }
  return { node: null, extraMs };
}

/**
 * Move a lead from `node` (just executed/evaluated) to its next node and schedule
 * that node's action. Marks the lead completed when the graph ends.
 */
export async function advanceLead(
  deps: EngineDeps,
  campaign: CampaignRow,
  state: LeadStateRow,
  node: SequenceNodeRow,
  outcome: "next" | "true" | "false",
): Promise<void> {
  const { byId } = await loadGraph(deps.db, campaign.id);
  const history = historyOf(state);
  history.push({ nodeId: node.id, type: node.type, at: now(deps).toISOString(), stepSeq: history.length, outcome });

  const { node: target, extraMs } = resolveWaitChain(nextNodeId(node, outcome), byId);
  if (!target) {
    await deps.db
      .updateTable("lead_campaign_state")
      .set({ status: "completed", current_node_id: null, history: JSON.stringify(history) })
      .where("id", "=", state.id)
      .execute();
    return;
  }

  const schedule = parseSchedule(campaign.schedule);
  const base = now(deps);
  const scheduledAt =
    extraMs > 0
      ? (deps.config.ignoreWorkingHours
          ? new Date(base.getTime() + extraMs)
          : computeFirstDispatchAt(schedule, new Date(base.getTime() + extraMs), false))
      : computeNextDispatchAt({
          schedule,
          from: base,
          minSpacingMs: deps.config.minSpacingMs,
          jitterMs: deps.config.jitterMs,
          ignoreWorkingHours: deps.config.ignoreWorkingHours,
        });

  await deps.db
    .updateTable("lead_campaign_state")
    .set({ current_node_id: target.id, history: JSON.stringify(history) })
    .where("id", "=", state.id)
    .execute();
  await scheduleNodeAction(deps, campaign, { ...state, history: history as never }, target, scheduledAt, history.length);
}

/**
 * The next free dispatch slot on the campaign's sending account. First actions
 * across newly-enrolled leads are staggered by the jittered ~6-min spacing so a
 * campaign start (or bulk enroll) NEVER bursts — the #1 account-safety rule
 * (CLAUDE.md §5/§6: "never burst"). Spacing aggregates across ALL campaigns on
 * the account (matching the rate governor): we chain off the latest already-
 * queued or executed action for the account, falling back to "now" when the
 * account's queue is empty/drained.
 */
async function nextAccountSlot(
  deps: EngineDeps,
  campaign: CampaignRow,
  schedule: import("@10xconnect/core").WeekSchedule,
  earliest: Date,
): Promise<Date> {
  const ignore = deps.config.ignoreWorkingHours;
  if (!campaign.account_id) {
    return computeFirstDispatchAt(schedule, earliest, ignore);
  }
  const row = await deps.db
    .selectFrom("actions")
    .select((eb) => eb.fn.max("scheduled_at").as("last"))
    .where("account_id", "=", campaign.account_id)
    .where((eb) => eb.or([eb("status", "=", "pending"), eb("executed_at", "is not", null)]))
    .executeTakeFirst();
  const last = row?.last ? new Date(row.last as unknown as string) : null;
  if (!last) {
    return computeFirstDispatchAt(schedule, earliest, ignore);
  }
  // Chain after the account's last scheduled action with jittered spacing; if that
  // lands before the earliest allowed time (e.g. a drained queue, or a wait_x_days
  // root pushes `earliest` further out), fall back to the earliest working slot.
  const chained = computeNextDispatchAt({
    schedule,
    from: last,
    minSpacingMs: deps.config.minSpacingMs,
    jitterMs: deps.config.jitterMs,
    ignoreWorkingHours: ignore,
  });
  return chained.getTime() >= earliest.getTime()
    ? chained
    : computeFirstDispatchAt(schedule, earliest, ignore);
}

/** Schedule the root node for a not-yet-started lead. */
async function scheduleLead(
  deps: EngineDeps,
  campaign: CampaignRow,
  rootNode: SequenceNodeRow,
  state: LeadStateRow,
): Promise<void> {
  const { node: target, extraMs } = resolveWaitChain(rootNode.id, await graphById(deps, campaign.id));
  const start = target ?? rootNode;
  const schedule = parseSchedule(campaign.schedule);
  const base = new Date(now(deps).getTime() + extraMs);
  const scheduledAt = await nextAccountSlot(deps, campaign, schedule, base);
  await deps.db
    .updateTable("lead_campaign_state")
    .set({ current_node_id: start.id })
    .where("id", "=", state.id)
    .execute();
  await scheduleNodeAction(deps, campaign, state, start, scheduledAt, 0);
}

async function graphById(deps: EngineDeps, campaignId: string): Promise<Map<string, SequenceNodeRow>> {
  return (await loadGraph(deps.db, campaignId)).byId;
}

export interface EnrollResult {
  enrolled: number;
  skippedSuppressed: number;
  skippedAlreadyContacted: number;
  skippedDuplicate: number;
}

/** Enroll leads, honoring suppression + skip-already-contacted (CLAUDE.md §7/§11). */
export async function enrollLeads(
  deps: EngineDeps,
  workspaceId: string,
  campaignId: string,
  leadIds: string[],
): Promise<EnrollResult> {
  const campaign = await getCampaign(deps.db, workspaceId, campaignId);
  if (!campaign) {
    throw new Error("Campaign not found");
  }
  const settings = asObject(campaign.settings);
  const skipAlready = settings.skip_already_contacted !== false;
  const result: EnrollResult = {
    enrolled: 0,
    skippedSuppressed: 0,
    skippedAlreadyContacted: 0,
    skippedDuplicate: 0,
  };
  const { rootId, byId } = await loadGraph(deps.db, campaignId);

  for (const leadId of leadIds) {
    const lead = await deps.db
      .selectFrom("leads")
      .select(["id", "linkedin_url", "email"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", leadId)
      .executeTakeFirst();
    if (!lead) {
      continue;
    }

    if (await isLeadSuppressed(deps.db, workspaceId, lead)) {
      result.skippedSuppressed += 1;
      continue;
    }
    if (skipAlready) {
      const elsewhere = await deps.db
        .selectFrom("lead_campaign_state")
        .select("id")
        .where("workspace_id", "=", workspaceId)
        .where("lead_id", "=", leadId)
        .where("campaign_id", "!=", campaignId)
        .executeTakeFirst();
      if (elsewhere) {
        result.skippedAlreadyContacted += 1;
        continue;
      }
    }

    const inserted = await deps.db
      .insertInto("lead_campaign_state")
      .values({
        workspace_id: workspaceId,
        lead_id: leadId,
        campaign_id: campaignId,
        status: "active",
        history: JSON.stringify([]),
      })
      .onConflict((oc) => oc.columns(["campaign_id", "lead_id"]).doNothing())
      .returning(["id", "workspace_id", "lead_id", "campaign_id", "current_node_id", "status", "history"])
      .executeTakeFirst();
    if (!inserted) {
      result.skippedDuplicate += 1;
      continue;
    }
    result.enrolled += 1;

    // If the campaign is already running, schedule the new lead immediately.
    if (campaign.status === "running" && rootId && byId.get(rootId)) {
      await scheduleLead(deps, campaign, byId.get(rootId) as SequenceNodeRow, inserted as LeadStateRow);
    }
  }
  return result;
}

export interface StartResult {
  scheduled: number;
}

/** Start a campaign: mark running and schedule the root for unstarted leads. */
export async function startCampaign(
  deps: EngineDeps,
  workspaceId: string,
  campaignId: string,
): Promise<StartResult> {
  const campaign = await getCampaign(deps.db, workspaceId, campaignId);
  if (!campaign) {
    throw new Error("Campaign not found");
  }
  if (!campaign.account_id) {
    throw new Error("Bind a sending account before starting the campaign.");
  }
  const { rootId, byId } = await loadGraph(deps.db, campaignId);
  if (!rootId) {
    throw new Error("Add at least one step to the sequence before starting.");
  }

  // Grounding gate (Phase 6 invariant 5): a campaign that REPLIES autonomously
  // must have a knowledge base, or AI replies could answer factual questions
  // ungrounded (inventing pricing/claims). approve_all is exempt — a human
  // approves every reply. Outbound personalization writes from enrichment, so
  // this gates only the autonomous-reply risk.
  const brain = await deps.db
    .selectFrom("campaigns")
    .select(["autonomy", "knowledge_base_id"])
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", campaignId)
    .executeTakeFirst();
  const mode = autonomyFrom(brain?.autonomy).mode;
  if ((mode === "auto_easy_escalate_hard" || mode === "full_auto") && !brain?.knowledge_base_id) {
    throw new Error(
      "Add a knowledge base before launching an auto-replying campaign, so AI replies stay grounded.",
    );
  }

  await deps.db
    .updateTable("campaigns")
    .set({ status: "running" })
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", campaignId)
    .execute();

  const states = (await deps.db
    .selectFrom("lead_campaign_state")
    .select(["id", "workspace_id", "lead_id", "campaign_id", "current_node_id", "status", "history"])
    .where("campaign_id", "=", campaignId)
    .where("status", "=", "active")
    .where("current_node_id", "is", null)
    .execute()) as LeadStateRow[];

  const root = byId.get(rootId) as SequenceNodeRow;
  for (const state of states) {
    await scheduleLead(deps, campaign, root, state);
  }
  return { scheduled: states.length };
}

/** Stop a campaign: mark stopped + cancel its pending actions. */
export async function stopCampaign(
  deps: EngineDeps,
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  await deps.db
    .updateTable("campaigns")
    .set({ status: "stopped" })
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", campaignId)
    .execute();
  await deps.db
    .updateTable("actions")
    .set({ status: "skipped" })
    .where("campaign_id", "=", campaignId)
    .where("status", "=", "pending")
    .execute();
}

export { getCampaign, isConditionType };
export type { CampaignRow };
