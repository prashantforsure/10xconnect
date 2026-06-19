// Warm-up ramp (CLAUDE.md §6, roadmap Step 17). A freshly connected account
// cannot send at full volume on day 1: caps ramp from reduced to full over ~4
// weeks. Pure functions — the worker computes account age and applies these.

import type { DailyCaps } from "../safety/caps";
import { CAPPED_ACTION_TYPES } from "../safety/caps";

/** Days from connection until the account reaches full caps. */
export const WARMUP_RAMP_DAYS = 28;

/**
 * Fraction (0..1] of full caps allowed at a given account age. Stepwise ramp so
 * early days are clearly throttled; reaches 1.0 after the ramp window.
 */
export function warmupMultiplier(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return 0.25;
  }
  if (ageDays >= WARMUP_RAMP_DAYS) {
    return 1;
  }
  if (ageDays >= 21) {
    return 0.8;
  }
  if (ageDays >= 14) {
    return 0.6;
  }
  if (ageDays >= 7) {
    return 0.4;
  }
  return 0.25; // first week
}

/** True once the account has finished warming up. */
export function isWarmupComplete(ageDays: number): boolean {
  return Number.isFinite(ageDays) && ageDays >= WARMUP_RAMP_DAYS;
}

/**
 * Apply the warm-up multiplier to a base caps map. Each cap is floored but kept
 * ≥1 when the base is ≥1, so a warming account can still make a little progress
 * each day without ever exceeding the (already safe-clamped) base.
 */
export function effectiveCaps(base: DailyCaps, ageDays: number): DailyCaps {
  const mult = warmupMultiplier(ageDays);
  const out = {} as DailyCaps;
  for (const type of CAPPED_ACTION_TYPES) {
    const baseCap = base[type] ?? 0;
    out[type] = baseCap <= 0 ? 0 : Math.max(1, Math.floor(baseCap * mult));
  }
  return out;
}

/** Days between two ISO timestamps (defaults `to` = now). Floored, ≥0. */
export function ageDaysSince(startedAtIso: string | null | undefined, to: Date = new Date()): number {
  if (!startedAtIso) {
    return 0;
  }
  const started = new Date(startedAtIso).getTime();
  if (Number.isNaN(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((to.getTime() - started) / 86_400_000));
}
