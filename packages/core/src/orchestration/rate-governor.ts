// Rate governor (CLAUDE.md §6, roadmap Step 16). Enforces per-account,
// per-action-type daily caps AGGREGATED across all campaigns for that account.
// Pure decision logic: the worker supplies today's used count (a DB aggregate
// over the `actions` table) and the effective cap (base caps after warm-up); the
// governor decides allow/deny. It NEVER permits exceeding the cap.

import type { CappedActionType, DailyCaps } from "../safety/caps";

import { effectiveCaps } from "./warmup";

export interface RateCheckInput {
  type: CappedActionType;
  /** Today's count of this action type for the account, across ALL campaigns. */
  usedToday: number;
  /** Base (already safe-clamped) caps for the campaign. */
  baseCaps: DailyCaps;
  /** Account age in days (drives the warm-up multiplier). */
  accountAgeDays: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Effective cap after warm-up. */
  cap: number;
  usedToday: number;
  remaining: number;
  reason?: string;
}

/**
 * Decide whether one more action of `type` may dispatch for the account today.
 * Allowed iff usedToday < effectiveCap. Returns a structured decision so the
 * caller can log/skip and reschedule.
 */
export function checkRate(input: RateCheckInput): RateDecision {
  const caps = effectiveCaps(input.baseCaps, input.accountAgeDays);
  const cap = caps[input.type] ?? 0;
  const usedToday = Math.max(0, input.usedToday);
  const remaining = Math.max(0, cap - usedToday);
  const allowed = usedToday < cap;
  return {
    allowed,
    cap,
    usedToday,
    remaining,
    reason: allowed
      ? undefined
      : cap === 0
        ? `${input.type} is not permitted yet (cap 0 — account still warming).`
        : `${input.type} daily cap reached (${usedToday}/${cap}).`,
  };
}

/**
 * Condition-check nodes silently load the profile, so they consume the
 * profile-visit budget (CLAUDE.md §6/§14). The worker charges visit_profile for
 * these when they run as the first node touching a lead.
 */
export const PROFILE_VISIT_CONSUMING_NODES: ReadonlySet<string> = new Set([
  "is_open_profile",
  "add_tag",
  "invite_accepted",
  "check_data_in_column",
  "message_opened",
  "message_replied",
  "is_first_level",
  "has_linkedin_url",
]);
