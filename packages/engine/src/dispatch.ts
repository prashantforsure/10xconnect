// The dispatch loop — the heart of the product (CLAUDE.md §5). Each tick the
// worker claims due actions and, per action: checks the account is sendable,
// enforces the rate governor (per-account daily caps, warm-up-adjusted, aggregated
// across campaigns), executes via the adapter, records the result idempotently
// (no double-sends), and advances the lead's sequence. Restriction/captcha
// failures flag the account and hold its work.

import {
  ageDaysSince,
  type CappedActionType,
  CAPPED_ACTION_TYPES,
  checkRate,
  defaultDailyCaps,
  isWarmupComplete,
  nextWorkingTime,
  type WeekSchedule,
} from "@10xconnect/core";
import type { Json } from "@10xconnect/db";

import { advanceLead, type CampaignRow } from "./campaign-runner";
import { evaluateCondition } from "./conditions";
import { executeTransportAction } from "./executor";
import { isConditionType, isOrchestrationNode, nodeToActionType } from "./nodes";
import { getLead, getLeadState, countActionsToday, loadGraph, startOfUtcDay } from "./repository";
import { flagAccountIncident } from "./restrictions";
import type { EngineDeps, LeadStateRow, SequenceNodeRow } from "./types";

const MAX_ATTEMPTS = 3;
const HOLD_MS = 60 * 60 * 1000; // account paused/restricted → re-check hourly

export interface DispatchStats {
  claimed: number;
  dispatched: number;
  advanced: number;
  denied: number;
  held: number;
  skipped: number;
  failed: number;
}

function nowOf(deps: EngineDeps): Date {
  return deps.now?.() ?? new Date();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseCaps(value: unknown): Record<CappedActionType, number> {
  const stored = asObject(value);
  const caps = defaultDailyCaps();
  for (const type of CAPPED_ACTION_TYPES) {
    const v = stored[type];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      caps[type] = Math.floor(v);
    }
  }
  return caps;
}

interface ClaimedAction {
  id: string;
  workspace_id: string;
  account_id: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  node_id: string | null;
  type: string;
  config: Json;
  idempotency_key: string;
  attempts: number;
  created_at: string;
  scheduled_at: string | null;
}

/** Claim due actions atomically (FOR UPDATE SKIP LOCKED) and mark them executing. */
async function claimDue(deps: EngineDeps, now: Date): Promise<ClaimedAction[]> {
  return deps.db.transaction().execute(async (trx) => {
    const due = (await trx
      .selectFrom("actions")
      .select([
        "id",
        "workspace_id",
        "account_id",
        "lead_id",
        "campaign_id",
        "node_id",
        "type",
        "config",
        "idempotency_key",
        "attempts",
        "created_at",
        "scheduled_at",
      ])
      .where("status", "=", "pending")
      .where("scheduled_at", "<=", now.toISOString())
      .orderBy("scheduled_at", "asc")
      .limit(deps.config.batchSize)
      .forUpdate()
      .skipLocked()
      .execute()) as ClaimedAction[];
    if (due.length > 0) {
      await trx
        .updateTable("actions")
        .set({ status: "executing" })
        .where(
          "id",
          "in",
          due.map((d) => d.id),
        )
        .execute();
    }
    return due;
  });
}

async function requeue(deps: EngineDeps, actionId: string, at: Date, config?: Json): Promise<void> {
  await deps.db
    .updateTable("actions")
    .set({ status: "pending", scheduled_at: at.toISOString(), ...(config ? { config } : {}) })
    .where("id", "=", actionId)
    .execute();
}

async function finalize(
  deps: EngineDeps,
  actionId: string,
  status: "success" | "failed" | "skipped",
  result: Json,
  attempts: number,
  now: Date,
): Promise<void> {
  await deps.db
    .updateTable("actions")
    .set({ status, result, attempts, executed_at: now.toISOString() })
    .where("id", "=", actionId)
    .execute();
}

/** Run one tick: claim due actions and process each. Safe to call repeatedly. */
export async function dispatchDueActions(deps: EngineDeps): Promise<DispatchStats> {
  const now = nowOf(deps);
  const stats: DispatchStats = {
    claimed: 0,
    dispatched: 0,
    advanced: 0,
    denied: 0,
    held: 0,
    skipped: 0,
    failed: 0,
  };
  const claimed = await claimDue(deps, now);
  stats.claimed = claimed.length;
  for (const action of claimed) {
    try {
      await processAction(deps, action, now, stats);
    } catch (err) {
      deps.log?.(`dispatch: action ${action.id} crashed: ${String(err)}`);
      // Don't strand it as 'executing'; mark failed so it won't be re-claimed.
      await finalize(deps, action.id, "failed", { error: "internal" } as Json, action.attempts + 1, now);
      stats.failed += 1;
    }
  }
  return stats;
}

async function processAction(
  deps: EngineDeps,
  action: ClaimedAction,
  now: Date,
  stats: DispatchStats,
): Promise<void> {
  const skip = (reason: string) =>
    finalize(deps, action.id, "skipped", { reason } as Json, action.attempts, now).then(() => {
      stats.skipped += 1;
    });

  if (!action.campaign_id || !action.lead_id || !action.node_id) {
    return skip("missing references");
  }

  const campaign = (await deps.db
    .selectFrom("campaigns")
    .select(["id", "workspace_id", "status", "account_id", "schedule", "settings", "caps"])
    .where("id", "=", action.campaign_id)
    .executeTakeFirst()) as (CampaignRow & { caps: Json }) | undefined;
  if (!campaign || campaign.status !== "running") {
    return skip("campaign not running");
  }

  const { byId } = await loadGraph(deps.db, campaign.id);
  const node = byId.get(action.node_id);
  if (!node) {
    return skip("node removed");
  }

  const state = await getLeadState(deps.db, campaign.id, action.lead_id);
  if (!state || state.status !== "active") {
    return skip("lead not active");
  }

  const lead = await getLead(deps.db, campaign.workspace_id, action.lead_id);
  if (!lead) {
    return skip("lead removed");
  }

  // Account must be sendable. Promote a finished warm-up; hold paused/restricted.
  const account = await deps.db
    .selectFrom("sending_accounts")
    .select(["id", "status", "provider_account_id", "warmup_state"])
    .where("id", "=", campaign.account_id ?? "")
    .executeTakeFirst();
  if (!account) {
    return skip("no sending account");
  }
  const ageDays = ageDaysSince(asObject(account.warmup_state).startedAt as string | undefined, now);
  if (account.status === "warming" && isWarmupComplete(ageDays)) {
    await deps.db.updateTable("sending_accounts").set({ status: "active" }).where("id", "=", account.id).execute();
    account.status = "active";
  }
  if (account.status === "disconnected") {
    return skip("account disconnected");
  }
  if (account.status === "paused" || account.status === "restricted") {
    await requeue(deps, action.id, new Date(now.getTime() + HOLD_MS));
    stats.held += 1;
    return;
  }

  // --- orchestration nodes (no transport) ---------------------------------
  if (isOrchestrationNode(node.type)) {
    if (node.type === "add_tag") {
      const tag = asObject(node.config).tag;
      if (typeof tag === "string" && tag.trim()) {
        const next = Array.from(new Set([...(lead.tags ?? []), tag.trim()]));
        await deps.db.updateTable("leads").set({ tags: next }).where("id", "=", lead.id).execute();
      }
    }
    await finalize(deps, action.id, "success", { type: node.type } as Json, action.attempts, now);
    await advanceLead(deps, campaign, state, node, "next");
    stats.advanced += 1;
    return;
  }

  // --- condition nodes -----------------------------------------------------
  if (isConditionType(node.type)) {
    const cfg = asObject(action.config);
    const firstCheckedAt = new Date(
      typeof cfg.firstCheckedAt === "string" ? cfg.firstCheckedAt : action.created_at,
    );
    const outcome = await evaluateCondition(deps, {
      workspaceId: campaign.workspace_id,
      node,
      lead,
      firstCheckedAt,
    });
    if (outcome === "wait") {
      const recheckMs = deps.config.ignoreWorkingHours ? deps.config.minSpacingMs : HOLD_MS;
      await requeue(deps, action.id, new Date(now.getTime() + recheckMs), {
        ...cfg,
        firstCheckedAt: firstCheckedAt.toISOString(),
      } as Json);
      stats.held += 1;
      return;
    }
    await finalize(deps, action.id, "success", { outcome } as Json, action.attempts, now);
    await advanceLead(deps, campaign, state, node, outcome);
    stats.advanced += 1;
    return;
  }

  // --- transport actions (rate-governed) -----------------------------------
  const actionType = nodeToActionType(node.type);
  if (!actionType || actionType === "email") {
    await finalize(deps, action.id, "skipped", { reason: "unsupported node" } as Json, action.attempts, now);
    stats.skipped += 1;
    return;
  }

  const usedToday = await countActionsToday(deps.db, account.id, actionType, now);
  const decision = checkRate({
    type: actionType as CappedActionType,
    usedToday,
    baseCaps: parseCaps(campaign.caps),
    accountAgeDays: ageDays,
  });
  if (!decision.allowed) {
    // Daily cap — retry in the next UTC day's working window (never exceed).
    const schedule = campaign.schedule as unknown as WeekSchedule;
    const tomorrow = new Date(startOfUtcDay(now).getTime() + 86_400_000);
    const next = deps.config.ignoreWorkingHours ? tomorrow : nextWorkingTime(schedule, tomorrow);
    await requeue(deps, action.id, next);
    stats.denied += 1;
    deps.log?.(`governor: held ${node.type} for account ${account.id} — ${decision.reason}`);
    return;
  }

  const enrichment = asObject(lead.enrichment);
  const result = await executeTransportAction({
    adapter: deps.adapter,
    accountRef: { accountId: account.id, providerAccountId: account.provider_account_id ?? undefined },
    leadRef: {
      leadId: lead.id,
      ...(lead.linkedin_url ? { linkedinUrl: lead.linkedin_url } : {}),
      ...(typeof enrichment.providerId === "string" ? { providerId: enrichment.providerId } : {}),
      ...(lead.email ? { email: lead.email } : {}),
    },
    workspaceId: campaign.workspace_id,
    nodeType: node.type,
    config: asObject(action.config),
    idempotencyKey: action.idempotency_key,
    lead,
    resolveContent: deps.resolveContent,
  });

  const attempts = action.attempts + 1;
  if (result.status === "success") {
    await finalize(deps, action.id, "success", result as unknown as Json, attempts, now);
    await advanceLead(deps, campaign, state, node, "next");
    stats.dispatched += 1;
    stats.advanced += 1;
    return;
  }

  // Failure handling.
  const code = result.error.code;
  // Surface the reason so failing sends are diagnosable from the worker log
  // (the full ActionResult is also persisted to actions.result for analytics).
  deps.log?.(
    `send failed: ${node.type} lead=${lead.id} account=${account.id} ` +
      `code=${code} retriable=${result.error.retriable} msg="${result.error.message}"`,
  );
  if (code === "account_restricted" || code === "captcha_required") {
    await finalize(deps, action.id, "failed", result as unknown as Json, attempts, now);
    await flagAccountIncident(
      deps.db,
      campaign.workspace_id,
      account.id,
      code === "account_restricted" ? "restricted" : "captcha",
    );
    stats.failed += 1;
    return;
  }
  if (result.error.retriable && attempts < MAX_ATTEMPTS) {
    const backoff = deps.config.minSpacingMs * 2 ** attempts;
    await requeue(deps, action.id, new Date(now.getTime() + backoff));
    // keep attempts counter
    await deps.db.updateTable("actions").set({ attempts }).where("id", "=", action.id).execute();
    stats.held += 1;
    return;
  }
  // Terminal failure → stop this lead (don't proceed to later steps).
  await finalize(deps, action.id, "failed", result as unknown as Json, attempts, now);
  await deps.db
    .updateTable("lead_campaign_state")
    .set({ status: "failed" })
    .where("id", "=", (state as LeadStateRow).id)
    .execute();
  stats.failed += 1;
}

/** Auto-mark a node row unused import guard (kept for clarity). */
export type { SequenceNodeRow };
