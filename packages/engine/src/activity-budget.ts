// Profile-visit budget accounting for ACTIVITY variables (Phase 11.6). When a node's
// message uses an activity variable (lastPost, recentActivitySummary, …) and that
// activity is missing/stale, a fresh LinkedIn profile READ is needed to fill it — and
// LinkedIn charges that as a profile visit. So we account for it through the SAME rate
// governor as visit_profile actions, not just freshness-gate it (CLAUDE.md §6/§11.6):
//   - if the profile-visit cap allows → read via the adapter, charge a visit_profile
//     action (so it counts across ALL campaigns for the account), and refresh the
//     lead's activity so the message personalizes from fresh data;
//   - if the cap is reached → skip the read (the variable renders empty via its
//     on_missing policy; the message still sends). Safety clamps the READ, never the
//     message.
// Idempotent per (account, lead, node, UTC day) so a retry never double-charges.

import {
  type AccountRef,
  type CappedActionType,
  type DailyCaps,
  checkRate,
  isActivityVariable,
  readMessageBody,
} from "@10xconnect/core";
import type { Json } from "@10xconnect/db";

import type { CampaignRow } from "./campaign-runner";
import { countActionsToday, startOfUtcDay } from "./repository";
import type { EngineDeps, LeadRow, SequenceNodeRow } from "./types";

const DAY_MS = 86_400_000;
/** Activity freshness window (matches the registry's activity freshnessDays). */
const ACTIVITY_FRESHNESS_DAYS = 30;
/** Text-bearing config keys a body may live under. */
const BODY_KEYS = ["body", "message", "text", "comment"];

export type ActivityVisitReason =
  | "no_activity_var"
  | "fresh"
  | "cap_reached"
  | "already_charged"
  | "read_failed"
  | "charged";

export interface ActivityVisitResult {
  charged: boolean;
  reason: ActivityVisitReason;
}

export interface ActivityVisitInput {
  accountRef: AccountRef;
  lead: LeadRow;
  campaign: CampaignRow;
  node: SequenceNodeRow;
  baseCaps: DailyCaps;
  accountAgeDays: number;
  throttleFactor?: number;
  now: Date;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The activity-variable keys referenced by a node's message body. */
export function activityVarsInNode(config: Record<string, unknown>): string[] {
  const body = readMessageBody(config, BODY_KEYS);
  const keys = body.segments
    .filter((s): s is { type: "variable"; key: string; fallback?: string } => s.type === "variable")
    .map((s) => s.key);
  return [...new Set(keys)].filter((k) => isActivityVariable(k));
}

/** Is the lead's activity data stale/absent (so a fresh read would be required)? */
function activityNeedsRead(lead: LeadRow, now: Date): boolean {
  const enrichment = asObject(lead.enrichment);
  const enrichedAt = enrichment.enrichedAt;
  if (typeof enrichedAt !== "string") return true; // never enriched → read needed
  const ms = new Date(enrichedAt).getTime();
  if (!Number.isFinite(ms)) return true;
  return now.getTime() - ms > ACTIVITY_FRESHNESS_DAYS * DAY_MS; // stale → read needed
}

/**
 * Charge the profile-visit budget for an activity-variable read on this node, if one
 * is warranted. Best-effort: governor-clamped, idempotent, and it never throws into
 * the dispatch path (failures are logged + swallowed). Returns what happened.
 */
export async function maybeChargeActivityProfileVisit(
  deps: EngineDeps,
  input: ActivityVisitInput,
): Promise<ActivityVisitResult> {
  const { lead, campaign, node, now } = input;

  const activityKeys = activityVarsInNode(asObject(node.config));
  if (activityKeys.length === 0) return { charged: false, reason: "no_activity_var" };
  if (!activityNeedsRead(lead, now)) return { charged: false, reason: "fresh" };

  // Profile-visit budget gate (across ALL campaigns for the account).
  const accountId = input.accountRef.accountId;
  const usedToday = await countActionsToday(deps.db, accountId, "visit_profile", now);
  const decision = checkRate({
    type: "visit_profile" as CappedActionType,
    usedToday,
    baseCaps: input.baseCaps,
    accountAgeDays: input.accountAgeDays,
    throttleFactor: input.throttleFactor,
  });
  if (!decision.allowed) {
    deps.log?.(
      `activity-visit: profile-visit cap reached for account ${accountId} — skipping fresh read ` +
        `for [${activityKeys.join(", ")}] (variable renders empty; message still sends)`,
    );
    return { charged: false, reason: "cap_reached" };
  }

  // Claim the charge idempotently (per account+lead+node+day) BEFORE the read, so a
  // retry of this dispatch never double-charges the budget.
  const day = startOfUtcDay(now).toISOString().slice(0, 10);
  const idk = `activity-visit:${accountId}:${lead.id}:${node.id}:${day}`;
  const claimed = await deps.db
    .insertInto("actions")
    .values({
      workspace_id: campaign.workspace_id,
      account_id: accountId,
      lead_id: lead.id,
      campaign_id: campaign.id,
      node_id: node.id,
      type: "visit_profile",
      status: "success",
      idempotency_key: idk,
      scheduled_at: now.toISOString(),
      executed_at: now.toISOString(),
      result: JSON.stringify({ reason: "activity_variable_read", keys: activityKeys }) as unknown as Json,
    })
    .onConflict((oc) => oc.column("idempotency_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!claimed) return { charged: false, reason: "already_charged" };

  // Perform the read + refresh the lead's activity so the message personalizes fresh.
  try {
    const url = lead.linkedin_url ?? "";
    if (url) {
      const profile = await deps.adapter.fetchProfile(input.accountRef, url);
      const enrichment = asObject(lead.enrichment);
      const merged = {
        ...enrichment,
        ...(profile.recentPosts ? { recentPosts: profile.recentPosts } : {}),
        enrichedAt: now.toISOString(),
      };
      await deps.db
        .updateTable("leads")
        .set({ enrichment: JSON.stringify(merged) as unknown as Json })
        .where("id", "=", lead.id)
        .execute();
      lead.enrichment = merged as unknown as LeadRow["enrichment"];
    }
  } catch (err) {
    deps.log?.(`activity-visit: profile read failed for lead ${lead.id}: ${String(err)}`);
    return { charged: true, reason: "read_failed" };
  }
  return { charged: true, reason: "charged" };
}
