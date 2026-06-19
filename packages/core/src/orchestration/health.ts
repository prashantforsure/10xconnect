// Account-health monitor (CLAUDE.md §6, roadmap Step 20). Acceptance rate is the
// top restriction predictor, so it weighs heavily. Pure scoring: the worker
// supplies counts (from `actions` + `lead_events`); this returns a 0–100 score
// and the safety signals. A restriction event forces the score to the floor.

export interface HealthInput {
  connectionRequestsSent: number;
  invitesAccepted: number;
  messagesSent: number;
  replies: number;
  restrictionEvents: number;
  captchaEvents: number;
}

export interface HealthResult {
  score: number;
  acceptanceRate: number | null;
  replyRate: number | null;
  /** True when a restriction has been observed — account should be paused. */
  restricted: boolean;
  signals: string[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Compute a 0–100 health score and the derived safety signals. */
export function computeHealth(input: HealthInput): HealthResult {
  const acceptanceRate = ratio(input.invitesAccepted, input.connectionRequestsSent);
  const replyRate = ratio(input.replies, input.messagesSent);
  const signals: string[] = [];

  let score = 100;

  if (input.restrictionEvents > 0) {
    // A restriction dominates everything else.
    signals.push("Account restriction detected — paused for safety.");
    return { score: 10, acceptanceRate, replyRate, restricted: true, signals };
  }

  if (input.captchaEvents > 0) {
    score -= 15 * input.captchaEvents;
    signals.push(`${input.captchaEvents} captcha/checkpoint event(s) — slow down.`);
  }

  // Acceptance rate only meaningful with a reasonable sample.
  if (input.connectionRequestsSent >= 10 && acceptanceRate !== null) {
    if (acceptanceRate < 0.15) {
      score -= 25;
      signals.push(`Low acceptance rate (${Math.round(acceptanceRate * 100)}%) — review targeting.`);
    } else if (acceptanceRate < 0.3) {
      score -= 10;
      signals.push(`Acceptance rate is soft (${Math.round(acceptanceRate * 100)}%).`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, acceptanceRate, replyRate, restricted: false, signals };
}
