import { env } from "@10xconnect/config";

import type { DispatchConfig } from "./types";

export type DispatchMode = "testing" | "production";

/**
 * Documented spacing presets for the two dispatch modes (CLAUDE.md §5).
 *
 * - testing (DEFAULT): visibly-fast pacing so a campaign runs to completion in
 *   seconds on the MOCK adapter — for demos and local dev. NEVER for a real
 *   LinkedIn account: the per-account daily caps still clamp the total, but at 1s
 *   spacing an account would burn its whole day's budget in a tight, bursty,
 *   obviously-automated window. Real sends must run in "production".
 * - production: real human pacing — 4–8 min jittered spacing (4-min base + up to
 *   4-min jitter, ~6 min average — jittered so it never bursts) within the
 *   account's working hours. Flip the switch at launch with DISPATCH_MODE=production.
 *
 * The per-account DAILY CAPS are the hard safety ceiling in BOTH modes; spacing
 * only controls cadence within the window, never the daily total.
 */
export const DISPATCH_PRESETS: Record<DispatchMode, Omit<DispatchConfig, "batchSize">> = {
  // testing: everything fast, and AI auto-replies fire instantly so demos/tests
  // don't wait on a humanizing delay.
  testing: { minSpacingMs: 1_000, jitterMs: 0, ignoreWorkingHours: true, aiReplyMinDelayMs: 0, aiReplyJitterMs: 0 },
  // production: human pacing for campaign sends (4–8 min) AND for AI auto-replies
  // (5–10 min = 5-min floor + up to 5-min jitter) so an autonomous reply never
  // looks like an instant bot answer.
  production: {
    minSpacingMs: 240_000,
    jitterMs: 240_000,
    ignoreWorkingHours: false,
    aiReplyMinDelayMs: 300_000,
    aiReplyJitterMs: 300_000,
  },
};

/**
 * Pure resolver: pick the preset for `mode`, then apply any per-field overrides
 * (an override of `undefined` keeps the preset value). Kept pure + exported so
 * the testing-vs-production toggle is unit-testable without touching env.
 */
export function resolveDispatchConfig(input: {
  mode: DispatchMode;
  minSpacingMs?: number;
  jitterMs?: number;
  ignoreWorkingHours?: boolean;
  batchSize?: number;
  aiReplyMinDelayMs?: number;
  aiReplyJitterMs?: number;
}): DispatchConfig {
  const preset = DISPATCH_PRESETS[input.mode] ?? DISPATCH_PRESETS.testing;
  return {
    minSpacingMs: input.minSpacingMs ?? preset.minSpacingMs,
    jitterMs: input.jitterMs ?? preset.jitterMs,
    ignoreWorkingHours: input.ignoreWorkingHours ?? preset.ignoreWorkingHours,
    batchSize: input.batchSize ?? 25,
    aiReplyMinDelayMs: input.aiReplyMinDelayMs ?? preset.aiReplyMinDelayMs ?? 0,
    aiReplyJitterMs: input.aiReplyJitterMs ?? preset.aiReplyJitterMs ?? 0,
  };
}

/**
 * Build the dispatch cadence config from validated env. DISPATCH_MODE (default
 * "testing") selects the preset; the optional DISPATCH_* env vars override
 * individual fields when set. To go live at launch: set DISPATCH_MODE=production.
 */
export function dispatchConfigFromEnv(): DispatchConfig {
  return resolveDispatchConfig({
    mode: env.DISPATCH_MODE,
    minSpacingMs: env.DISPATCH_MIN_SPACING_MS,
    jitterMs: env.DISPATCH_JITTER_MS,
    ignoreWorkingHours: env.DISPATCH_IGNORE_WORKING_HOURS,
    aiReplyMinDelayMs: env.AI_AUTO_REPLY_MIN_DELAY_MS,
    aiReplyJitterMs: env.AI_AUTO_REPLY_JITTER_MS,
  });
}
