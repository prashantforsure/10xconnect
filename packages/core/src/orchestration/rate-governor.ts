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
  /**
   * Acceptance-rate auto-throttle multiplier in (0, 1] (default 1). Applied AFTER
   * warm-up, so a poorly-accepting account is held below its warmed cap (§6). See
   * acceptanceThrottle / readThrottleFactor.
   */
  throttleFactor?: number;
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
  const warmedCap = caps[input.type] ?? 0;
  // Apply the acceptance-rate throttle on top of warm-up. A throttled cap stays ≥1
  // (throttle slows the account; it never fully halts — that's a restriction pause).
  const factor = Number.isFinite(input.throttleFactor) ? Math.min(1, Math.max(0, input.throttleFactor as number)) : 1;
  const cap = warmedCap <= 0 || factor <= 0 ? 0 : factor >= 1 ? warmedCap : Math.max(1, Math.floor(warmedCap * factor));
  const usedToday = Math.max(0, input.usedToday);
  const remaining = Math.max(0, cap - usedToday);
  const allowed = usedToday < cap;
  const throttled = factor < 1 && cap < warmedCap;
  return {
    allowed,
    cap,
    usedToday,
    remaining,
    reason: allowed
      ? undefined
      : cap === 0
        ? `${input.type} is not permitted yet (cap 0 — account still warming).`
        : throttled
          ? `${input.type} throttled daily cap reached (${usedToday}/${cap}; acceptance-rate throttle active).`
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
