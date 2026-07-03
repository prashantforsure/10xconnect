// Campaign lifecycle + per-lead graph progression. enroll/start/stop create
// lead_campaign_state and the first due action; advanceLead moves a lead to its
// next node and schedules that node's action (respecting wait_x_days, working
// hours, and ~6-min jitter). The worker tick executes the scheduled actions.

import { randomUUID } from "node:crypto";

import { autonomyFrom, computeFirstDispatchAt, computeNextDispatchAt } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { isConditionType, nodeToActionType } from "./nodes";
import { loadGraph } from "./repository";
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
  idempotencyKey?: string,
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
      // Default key ties retries of the same step together (no double-send). A
      // resume passes an explicit unique key so its fresh action doesn't collide
      // with the paused (skipped) one at the same step (see resumeCampaign).
      idempotency_key: idempotencyKey ?? `${campaign.id}:${state.lead_id}:${node.id}:${stepSeq}`,
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
 * Flip a running campaign to `completed` once every enrolled lead is terminal
 * (completed/replied/failed/stopped). One atomic guarded UPDATE — the active-
 * lead check happens at execution time, so concurrent lead completions are
 * idempotent and a concurrently-enrolled active lead blocks the flip. Campaigns
 * with no enrolled leads are never auto-completed (a live import may still feed
 * them), and enrolling into a completed campaign reopens it (see enrollLeads).
 */
export async function maybeCompleteCampaign(deps: { db: Kysely<DB> }, campaignId: string): Promise<void> {
  await deps.db
    .updateTable("campaigns")
    .set({ status: "completed" })
    .where("id", "=", campaignId)
    .where("status", "=", "running")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("lead_campaign_state")
            .select("id")
            .where("campaign_id", "=", campaignId)
            .where("status", "=", "active"),
        ),
      ),
    )
    .where((eb) =>
      eb.exists(eb.selectFrom("lead_campaign_state").select("id").where("campaign_id", "=", campaignId)),
    )
    .execute();
}

/**
 * Move a lead from `node` (just executed/evaluated) to its next node and schedule
 * that node's action. Marks the lead completed when the graph ends. State update
 * + next-action insert are atomic — a failure between them can no longer strand
 * the lead on a node with no pending action.
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
    await deps.db.transaction().execute(async (trx) => {
      await trx
        .updateTable("lead_campaign_state")
        .set({ status: "completed", current_node_id: null, history: JSON.stringify(history) })
        .where("id", "=", state.id)
        .execute();
      await maybeCompleteCampaign({ ...deps, db: trx }, campaign.id);
    });
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

  await deps.db.transaction().execute(async (trx) => {
    const tdeps: EngineDeps = { ...deps, db: trx };
    await trx
      .updateTable("lead_campaign_state")
      .set({ current_node_id: target.id, history: JSON.stringify(history) })
      .where("id", "=", state.id)
      .execute();
    await scheduleNodeAction(tdeps, campaign, { ...state, history: history as never }, target, scheduledAt, history.length);
  });
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

/** Split into chunks so batched IN(...) / bulk inserts stay under Postgres' bind
 * limit (~65535 params) on very large enrollments (e.g. "all contacts"). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
const ENROLL_CHUNK = 1000;

/**
 * Enroll leads, honoring suppression + skip-already-contacted (CLAUDE.md §7/§11).
 * Batched: instead of ~4 queries PER lead (which made a 10k enroll ~40k
 * round-trips), the suppression list and cross-campaign membership are loaded in
 * bulk and inserts are chunked. Only per-lead scheduling remains a loop — and
 * only for an already-running campaign — because each first action must be
 * staggered off the account's queue (never burst, §5).
 */
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

  const uniqueLeadIds = [...new Set(leadIds)];
  if (uniqueLeadIds.length === 0) {
    return result;
  }
  const chunks = chunk(uniqueLeadIds, ENROLL_CHUNK);

  // 1) Load every target lead's identifiers in bulk (drops ids not in workspace).
  const leadById = new Map<string, { id: string; linkedin_url: string | null; email: string | null }>();
  for (const ids of chunks) {
    const rows = await deps.db
      .selectFrom("leads")
      .select(["id", "linkedin_url", "email"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "in", ids)
      .execute();
    for (const r of rows) {
      leadById.set(r.id, r);
    }
  }

  // 2) The workspace do-not-contact list, once. Matched exactly on email and
  //    linkedin_url — identical predicate to isLeadSuppressed, just set-based.
  const dnc = await deps.db
    .selectFrom("do_not_contact")
    .select(["email", "linkedin_url"])
    .where("workspace_id", "=", workspaceId)
    .execute();
  const dncEmails = new Set(dnc.map((d) => d.email).filter((v): v is string => Boolean(v)));
  const dncUrls = new Set(dnc.map((d) => d.linkedin_url).filter((v): v is string => Boolean(v)));

  // 3) Leads already enrolled in ANOTHER campaign (skip-already-contacted), once.
  const elsewhere = new Set<string>();
  if (skipAlready) {
    for (const ids of chunks) {
      const rows = await deps.db
        .selectFrom("lead_campaign_state")
        .select("lead_id")
        .where("workspace_id", "=", workspaceId)
        .where("campaign_id", "!=", campaignId)
        .where("lead_id", "in", ids)
        .execute();
      for (const r of rows) {
        elsewhere.add(r.lead_id);
      }
    }
  }

  // 4) Partition in memory (requested order preserved), counting skip reasons.
  const toInsert: string[] = [];
  for (const leadId of uniqueLeadIds) {
    const lead = leadById.get(leadId);
    if (!lead) {
      continue; // unknown / cross-workspace id — silently ignored, as before
    }
    const suppressed =
      (lead.email !== null && dncEmails.has(lead.email)) ||
      (lead.linkedin_url !== null && dncUrls.has(lead.linkedin_url));
    if (suppressed) {
      result.skippedSuppressed += 1;
      continue;
    }
    if (skipAlready && elsewhere.has(leadId)) {
      result.skippedAlreadyContacted += 1;
      continue;
    }
    toInsert.push(leadId);
  }

  // 5) Bulk insert; ON CONFLICT skips leads already in THIS campaign (RETURNING
  //    tells us which actually inserted → the rest are duplicates).
  const inserted: LeadStateRow[] = [];
  for (const ids of chunk(toInsert, ENROLL_CHUNK)) {
    const rows = (await deps.db
      .insertInto("lead_campaign_state")
      .values(
        ids.map((leadId) => ({
          workspace_id: workspaceId,
          lead_id: leadId,
          campaign_id: campaignId,
          status: "active",
          history: JSON.stringify([]),
        })),
      )
      .onConflict((oc) => oc.columns(["campaign_id", "lead_id"]).doNothing())
      .returning(["id", "workspace_id", "lead_id", "campaign_id", "current_node_id", "status", "history"])
      .execute()) as LeadStateRow[];
    inserted.push(...rows);
  }
  result.enrolled = inserted.length;
  result.skippedDuplicate = toInsert.length - inserted.length;

  // 6) If the campaign is already running (or auto-completed — new leads reopen
  //    it, so continuous imports keep flowing), schedule each new lead. Kept a
  //    loop on purpose: each first action is staggered off the account queue.
  if ((campaign.status === "running" || campaign.status === "completed") && rootId && byId.get(rootId)) {
    const root = byId.get(rootId) as SequenceNodeRow;
    for (const state of inserted) {
      await scheduleLead(deps, campaign, root, state);
    }
  }

  // 7) Reopen an auto-completed campaign that just received fresh leads. Runs on
  //    the status guard (not the possibly-stale read above) so a completion
  //    racing this enroll converges to "running" either way.
  if (result.enrolled > 0) {
    await deps.db
      .updateTable("campaigns")
      .set({ status: "running" })
      .where("id", "=", campaignId)
      .where("status", "=", "completed")
      .execute();
  }
  return result;
}

export interface StartResult {
  scheduled: number;
}

/**
 * Start a campaign: mark running and schedule the root for unstarted leads.
 * Runs inside ONE transaction holding a row lock on the campaign — this
 * serializes start against saveSequence (which takes the same lock): either
 * the save commits first and start reads the NEW graph, or start wins and the
 * save is rejected. It also makes the status flip atomic with lead scheduling,
 * so a mid-start failure never leaves a "running" campaign with unscheduled leads.
 */
export async function startCampaign(
  deps: EngineDeps,
  workspaceId: string,
  campaignId: string,
): Promise<StartResult> {
  return await deps.db.transaction().execute(async (trx) => {
    const tdeps: EngineDeps = { ...deps, db: trx };
    const campaign = (await trx
      .selectFrom("campaigns")
      .select([
        "id",
        "workspace_id",
        "status",
        "account_id",
        "schedule",
        "settings",
        "caps",
        "autonomy",
        "knowledge_base_id",
      ])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .forUpdate()
      .executeTakeFirst()) as
      | (CampaignRow & { caps: unknown; autonomy: unknown; knowledge_base_id: string | null })
      | undefined;
    if (!campaign) {
      throw new Error("Campaign not found");
    }
    if (!campaign.account_id) {
      throw new Error("Bind a sending account before starting the campaign.");
    }

    // All-zero caps would "run" the campaign without ever sending anything —
    // surface that instead of sitting silently idle. (Empty caps use defaults.)
    const capValues = Object.values(asObject(campaign.caps)).filter((v): v is number => typeof v === "number");
    if (capValues.length > 0 && capValues.every((v) => v === 0)) {
      throw new Error(
        "Every action cap is 0, so no actions would ever send — raise at least one daily cap (Settings → Frequency) before starting.",
      );
    }

    const { rootId, byId } = await loadGraph(trx, campaignId);
    if (!rootId) {
      throw new Error("Add at least one step to the sequence before starting.");
    }

    // Grounding gate (Phase 6 invariant 5): a campaign that REPLIES autonomously
    // must have a knowledge base, or AI replies could answer factual questions
    // ungrounded (inventing pricing/claims). approve_all is exempt — a human
    // approves every reply. Outbound personalization writes from enrichment, so
    // this gates only the autonomous-reply risk.
    const mode = autonomyFrom(campaign.autonomy).mode;
    if ((mode === "auto_easy_escalate_hard" || mode === "full_auto") && !campaign.knowledge_base_id) {
      throw new Error(
        "Add a knowledge base before launching an auto-replying campaign, so AI replies stay grounded.",
      );
    }

    await trx
      .updateTable("campaigns")
      .set({ status: "running" })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .execute();

    const states = (await trx
      .selectFrom("lead_campaign_state")
      .select(["id", "workspace_id", "lead_id", "campaign_id", "current_node_id", "status", "history"])
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "active")
      .where("current_node_id", "is", null)
      .execute()) as LeadStateRow[];

    const root = byId.get(rootId) as SequenceNodeRow;
    for (const state of states) {
      await scheduleLead(tdeps, campaign, root, state);
    }
    return { scheduled: states.length };
  });
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

/**
 * Pause a running campaign — freeze in place, resumable (distinct from stop,
 * which is terminal). Each lead's position (current_node_id) is left untouched;
 * only the queued sequence actions are cancelled. They're re-created on resume
 * with fresh, jittered slots so a resume NEVER bursts (the #1 safety rule, §5).
 * Node-less conversation actions (inbox replies / AI turns) are deliberately
 * left alone — pausing outreach shouldn't drop an in-flight reply to someone
 * who already responded. Guarded on `running` so a double-click is idempotent.
 */
export async function pauseCampaign(
  deps: EngineDeps,
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  await deps.db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("campaigns")
      .select(["id", "status"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) {
      throw new Error("Campaign not found");
    }
    if (row.status !== "running") {
      throw new Error("Only a running campaign can be paused.");
    }
    await trx
      .updateTable("campaigns")
      .set({ status: "paused" })
      .where("id", "=", campaignId)
      .execute();
    await trx
      .updateTable("actions")
      .set({ status: "skipped" })
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "pending")
      .where("node_id", "is not", null)
      .execute();
  });
}

/**
 * Resume a paused campaign: flip back to running and re-schedule every active
 * lead from where it stopped (its current node), or from the root if it never
 * started. Guarded on `paused` (with a row lock) so concurrent/double resumes
 * run the scheduling loop exactly once. Leads that somehow still hold a live
 * action are skipped, so no lead is ever double-queued.
 */
export async function resumeCampaign(
  deps: EngineDeps,
  workspaceId: string,
  campaignId: string,
): Promise<StartResult> {
  return await deps.db.transaction().execute(async (trx) => {
    const tdeps: EngineDeps = { ...deps, db: trx };
    const campaign = (await trx
      .selectFrom("campaigns")
      .select(["id", "workspace_id", "status", "account_id", "schedule", "settings"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .forUpdate()
      .executeTakeFirst()) as CampaignRow | undefined;
    if (!campaign) {
      throw new Error("Campaign not found");
    }
    if (campaign.status !== "paused") {
      throw new Error("Only a paused campaign can be resumed.");
    }
    if (!campaign.account_id) {
      throw new Error("Bind a sending account before resuming the campaign.");
    }
    const { rootId, byId } = await loadGraph(trx, campaignId);
    if (!rootId) {
      throw new Error("Add at least one step to the sequence before resuming.");
    }

    await trx
      .updateTable("campaigns")
      .set({ status: "running" })
      .where("id", "=", campaignId)
      .execute();

    const states = (await trx
      .selectFrom("lead_campaign_state")
      .select(["id", "workspace_id", "lead_id", "campaign_id", "current_node_id", "status", "history"])
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "active")
      .execute()) as LeadStateRow[];

    let scheduled = 0;
    for (const state of states) {
      const live = await trx
        .selectFrom("actions")
        .select("id")
        .where("campaign_id", "=", campaignId)
        .where("lead_id", "=", state.lead_id)
        .where("status", "in", ["pending", "executing"])
        .executeTakeFirst();
      if (live) {
        continue;
      }
      const fromNode = byId.get(state.current_node_id ?? rootId);
      if (!fromNode) {
        continue;
      }
      await scheduleLeadResume(tdeps, campaign, fromNode, state);
      scheduled += 1;
    }
    return { scheduled };
  });
}

/**
 * Schedule a resumed lead at `fromNode` (its current position), staggered off the
 * account's queue. Uses a unique idempotency key so the fresh action doesn't
 * collide (ON CONFLICT) with the paused/skipped action still sitting at the same
 * step; resume itself is campaign-guarded, so a random key can't cause a
 * double-send (only leads with no live action reach here).
 */
async function scheduleLeadResume(
  deps: EngineDeps,
  campaign: CampaignRow,
  fromNode: SequenceNodeRow,
  state: LeadStateRow,
): Promise<void> {
  const { node: target, extraMs } = resolveWaitChain(fromNode.id, await graphById(deps, campaign.id));
  const start = target ?? fromNode;
  const schedule = parseSchedule(campaign.schedule);
  const base = new Date(now(deps).getTime() + extraMs);
  const scheduledAt = await nextAccountSlot(deps, campaign, schedule, base);
  await deps.db
    .updateTable("lead_campaign_state")
    .set({ current_node_id: start.id })
    .where("id", "=", state.id)
    .execute();
  const key = `${campaign.id}:${state.lead_id}:${start.id}:resume:${randomUUID()}`;
  await scheduleNodeAction(deps, campaign, state, start, scheduledAt, historyOf(state).length, key);
}

export { getCampaign, isConditionType };
export type { CampaignRow };
