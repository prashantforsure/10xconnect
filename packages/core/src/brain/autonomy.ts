// Autonomy dial (pure) — Phase 4. Given the campaign's mode + this draft's
// confidence/grounding/policy, decide auto-send vs route-to-human. The dial only
// graduates the EASY turns; hot leads + sensitive topics are handed off upstream
// (never reach here), and the Phase 3 caps (max turns, cooldown, budget) gate
// every send regardless of mode.

import type { AutonomyMode } from "./prompts";

export interface AutonomyInput {
  mode: AutonomyMode;
  /** This draft's confidence [0..1] (top retrieval similarity for grounded answers). */
  confidence: number;
  /** Auto-send confidence threshold (auto_easy only). */
  threshold: number;
  /** Is the answer fully grounded in retrieved knowledge (factual answers)? */
  grounded: boolean;
  /**
   * Does this reply assert factual claims (a KB "answer")? Conversational turns
   * (acknowledgements, objections, qualifying, soft CTAs) assert no facts, so in
   * Balanced (auto_easy) mode they auto-send without a grounding/confidence gate —
   * the draft prompt forbids inventing facts, and hot/sensitive turns already
   * escalated upstream. Only a factual answer is held when ungrounded/low-confidence.
   */
  assertsFacts: boolean;
  /** Passed policy (not a sensitive/hot topic — those escalate before this). */
  inPolicy: boolean;
}

export interface AutonomyDecision {
  send: boolean;
  reason:
    | "approve_all"
    | "out_of_policy"
    | "not_grounded"
    | "low_confidence"
    | "auto_easy_confident"
    | "full_auto";
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * approve_all ("Manual") → never auto-send (human approves every draft).
 * auto_easy_escalate_hard ("Balanced") → auto-send conversational replies (which
 *   assert no facts); a factual answer must be grounded AND confident, else it
 *   waits for approval. Sensitive/hot topics already escalated upstream.
 * full_auto ("Autopilot") → send (the Phase 3 caps still bound it; hot already gone).
 */
export function decideAutonomy(input: AutonomyInput): AutonomyDecision {
  if (input.mode === "approve_all") return { send: false, reason: "approve_all" };
  if (!input.inPolicy) return { send: false, reason: "out_of_policy" };
  if (input.mode === "full_auto") return { send: true, reason: "full_auto" };
  // auto_easy_escalate_hard ("Balanced"): only a factual answer is gated on
  // grounding + confidence; conversational turns auto-send (no fact to ground).
  if (input.assertsFacts) {
    if (!input.grounded) return { send: false, reason: "not_grounded" };
    if (input.confidence < input.threshold) return { send: false, reason: "low_confidence" };
  }
  return { send: true, reason: "auto_easy_confident" };
}
