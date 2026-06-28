// Hot-lead handoff summary (pure) — Phase 4. When a lead goes hot we assemble a
// briefing for the human: who they are, what was discussed, key facts, current
// intent, and a suggested next step. Deterministic (no model call) — the point of
// the handoff is to STOP spending and get a person involved fast.

import type { HotLeadReason } from "./hotlead";

export interface HandoffSummaryInput {
  name: string;
  headline?: string | null;
  company?: string | null;
  role?: string | null;
  intent: string;
  intentScore: number;
  reasons: HotLeadReason[];
  /** Known facts about the lead (bodies). */
  facts: string[];
  /** Recent thread, oldest→newest. */
  recentMessages: { direction: "inbound" | "outbound"; body: string }[];
  lastMessage: string;
}

export interface HandoffSummary {
  text: string;
  nextStep: string;
}

const REASON_LABEL: Record<HotLeadReason, string> = {
  buying_signal: "explicit buying signal",
  meeting_request: "asked to meet",
  high_intent: "high intent score",
  pricing: "pricing question",
  legal: "legal/security topic",
  competitor: "competitor comparison",
  custom_guardrail: "matched a campaign guardrail",
};

function suggestNextStep(reasons: HotLeadReason[], intent: string): string {
  if (reasons.includes("meeting_request") || reasons.includes("buying_signal")) {
    return "Reply personally and propose a specific time for a quick call.";
  }
  if (reasons.includes("pricing")) {
    return "Share pricing in your own words and offer a short call to walk through it.";
  }
  if (reasons.includes("legal")) {
    return "Loop in the right person for legal/security and acknowledge the request.";
  }
  if (reasons.includes("competitor")) {
    return "Position honestly vs. the alternative and offer to compare on a call.";
  }
  if (intent === "interested") {
    return "Keep the momentum — reply personally and suggest a next step.";
  }
  return "Reply personally — this lead is warm and worth your time.";
}

/** Build the human-readable hot-lead briefing + a suggested next step. */
export function buildHandoffSummary(input: HandoffSummaryInput): HandoffSummary {
  const who = [input.name, input.role, input.company].filter(Boolean).join(" · ") || input.name;
  const why = input.reasons.map((r) => REASON_LABEL[r]).join(", ") || "warm engagement";
  const facts = input.facts.length ? input.facts.map((f) => `- ${f}`).join("\n") : "- (none captured yet)";
  const thread = input.recentMessages
    .slice(-6)
    .map((m) => `${m.direction === "inbound" ? "Them" : "You"}: ${m.body}`)
    .join("\n");
  const nextStep = suggestNextStep(input.reasons, input.intent);

  const text = [
    `🔥 Hot lead — ${who}`,
    input.headline ? `Headline: ${input.headline}` : null,
    `Why now: ${why}`,
    `Current intent: ${input.intent} (score ${input.intentScore})`,
    `Their last message: "${input.lastMessage}"`,
    `Key facts:\n${facts}`,
    thread ? `Recent thread:\n${thread}` : null,
    `Suggested next step: ${nextStep}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { text, nextStep };
}
