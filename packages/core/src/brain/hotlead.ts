// Hot-lead detection (pure) — Phase 4. Three detectors run together on a prospect
// reply; ANY firing makes the lead "hot" → the engine hands it to a human with a
// summary (sets stage=hot_lead, marks important, PAUSES the AI, notifies). These
// are deterministic + free so detection never costs a model call. Money/legal/
// buying-intent always reach a person — never an auto-send (CLAUDE.md §2).

import type { Intent } from "./analysis";

/** Why a lead was flagged hot (drives the handoff summary + notification copy). */
export type HotLeadReason =
  | "buying_signal"
  | "meeting_request"
  | "high_intent"
  | "pricing"
  | "legal"
  | "competitor"
  | "custom_guardrail";

export interface HotLeadSignals {
  intent: Intent;
  /** intent_score AFTER applying this turn's delta (the live estimate). */
  projectedIntentScore: number;
  /** The inbound message (for keyword guardrail matching). */
  message: string;
  /** Campaign-configured escalate-on topics (guardrails.escalate_on). */
  escalateOn?: string[];
}

export interface HotLeadDecision {
  hot: boolean;
  reasons: HotLeadReason[];
}

export const DEFAULT_HOT_INTENT_THRESHOLD = 60;

// Explicit "I want to buy / move forward" language.
const BUYING_SIGNALS = [
  "ready to buy", "want to buy", "ready to move forward", "move forward", "let's do it", "lets do it",
  "let's go", "lets go", "sign up", "sign me up", "get started", "where do i sign", "send me a contract",
  "send a contract", "send me a quote", "send a quote", "send me a proposal", "send a proposal", "proposal",
  "purchase", "procurement", "how do i buy", "how do we buy", "let's proceed", "lets proceed", "ready when you are",
];

// Money talk → a human. (Kept tight — no "plan"/"budget" alone, to avoid feature
// questions like "what's in the Pro plan?".)
const PRICING = ["price", "pricing", "cost", "how much", "quote", "discount", "afford", "expensive", "per seat", "per-seat"];

// Legal / security / compliance → a human.
const LEGAL = [
  "contract", "msa", "dpa", "terms of service", "legal", "compliance", "security review",
  "soc 2", "soc2", "gdpr", "data processing", "liability", "sla", "redline",
];

// Explicit competitor comparisons → a human (positioning is judgment, not
// retrieval). Kept tight: dropped "instead of" / "better than" / bare "vs " which
// fire on ordinary build-vs-buy objections ("why you instead of building it
// ourselves?") — those should get a normal reply, not an escalation.
const COMPETITOR = [
  "compared to", "versus", "switch from", "switching from",
  "alternative to", "how do you compare", "competitor",
];

function norm(text: string): string {
  return (text ?? "").toLowerCase();
}
function has(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/** Explicit buying language ("send me a quote", "ready to move forward"). */
export function detectBuyingSignal(message: string): boolean {
  return has(norm(message), BUYING_SIGNALS);
}

/** Sensitive topics that always require a human (used for the handoff reason). */
export function detectSensitiveTopics(message: string): { pricing: boolean; legal: boolean; competitor: boolean } {
  const t = norm(message);
  return { pricing: has(t, PRICING), legal: has(t, LEGAL), competitor: has(t, COMPETITOR) };
}

/**
 * Run all hot-lead detectors. ANY signal → hot. Pricing/legal/competitor and
 * buying language always escalate REGARDLESS of confidence/mode (handled by the
 * engine handing off before the autonomy decision).
 */
export function detectHotLead(
  s: HotLeadSignals,
  opts?: { intentThreshold?: number },
): HotLeadDecision {
  const t = norm(s.message);
  const reasons: HotLeadReason[] = [];
  if (detectBuyingSignal(s.message)) reasons.push("buying_signal");
  if (s.intent === "meeting") reasons.push("meeting_request");
  if (s.projectedIntentScore >= (opts?.intentThreshold ?? DEFAULT_HOT_INTENT_THRESHOLD)) reasons.push("high_intent");
  const sensitive = detectSensitiveTopics(s.message);
  if (sensitive.pricing) reasons.push("pricing");
  if (sensitive.legal) reasons.push("legal");
  if (sensitive.competitor) reasons.push("competitor");
  if (s.escalateOn?.length && s.escalateOn.some((topic) => topic.trim() && t.includes(topic.toLowerCase()))) {
    reasons.push("custom_guardrail");
  }
  return { hot: reasons.length > 0, reasons };
}
