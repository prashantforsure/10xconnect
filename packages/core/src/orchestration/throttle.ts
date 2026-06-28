// Acceptance-rate auto-throttle (CLAUDE.md §6 — acceptance rate is the top
// restriction predictor). When a sending account's connection-acceptance rate
// drops below a safe threshold (with a meaningful sample), we automatically REDUCE
// its effective daily caps — a softer, earlier response than a full restriction
// pause. Pure decision logic: the worker supplies the real acceptance rate (from
// `actions` + `lead_events`); this returns a cap multiplier the rate governor
// applies alongside the warm-up multiplier.

/** Below this acceptance rate (with sample) caps are softly throttled. */
export const ACCEPTANCE_THROTTLE_THRESHOLD = 0.2;
/** Below this, caps are throttled hard. */
export const ACCEPTANCE_THROTTLE_SEVERE = 0.1;
/** Minimum connection requests before acceptance rate is trusted. */
export const ACCEPTANCE_THROTTLE_MIN_SAMPLE = 10;

export interface ThrottleDecision {
  /** Cap multiplier in (0, 1]; 1 = no throttle. */
  factor: number;
  throttled: boolean;
  reason?: string;
}

/**
 * Decide the acceptance-rate throttle. Needs a meaningful sample — a couple of
 * early rejections shouldn't throttle. Soft (<20%) halves caps; severe (<10%)
 * quarters them.
 */
export function acceptanceThrottle(input: {
  acceptanceRate: number | null;
  connectionRequestsSent: number;
}): ThrottleDecision {
  const { acceptanceRate, connectionRequestsSent } = input;
  if (acceptanceRate === null || connectionRequestsSent < ACCEPTANCE_THROTTLE_MIN_SAMPLE) {
    return { factor: 1, throttled: false };
  }
  const pct = Math.round(acceptanceRate * 100);
  if (acceptanceRate < ACCEPTANCE_THROTTLE_SEVERE) {
    return { factor: 0.25, throttled: true, reason: `Acceptance rate ${pct}% — caps throttled to 25% to protect the account.` };
  }
  if (acceptanceRate < ACCEPTANCE_THROTTLE_THRESHOLD) {
    return { factor: 0.5, throttled: true, reason: `Acceptance rate ${pct}% — caps throttled to 50%.` };
  }
  return { factor: 1, throttled: false };
}

/**
 * Read the persisted throttle factor off an account's warmup_state jsonb (the
 * auto-throttle stores `{ throttle: { factor } }` there). Defaults to 1 (no
 * throttle) and clamps to (0, 1].
 */
export function readThrottleFactor(warmupState: unknown): number {
  const ws = warmupState && typeof warmupState === "object" ? (warmupState as Record<string, unknown>) : {};
  const throttle = ws.throttle && typeof ws.throttle === "object" ? (ws.throttle as Record<string, unknown>) : {};
  const f = typeof throttle.factor === "number" ? throttle.factor : 1;
  if (!Number.isFinite(f) || f <= 0) return 1;
  return Math.min(1, f);
}
