// Pure unit tests for the Phase 3 conversation governor primitives (no DB, no
// model): the pre-gate dispositions, limit/budget parsing, and cost estimation.

import assert from "node:assert/strict";
import { test } from "node:test";

import { decideAutonomy } from "./autonomy";
import { AI_IDENTITY_RESPONSE, detectAiIdentityQuestion } from "./canned";
import { buildHandoffSummary } from "./handoff";
import { detectBuyingSignal, detectHotLead } from "./hotlead";
import { budgetFrom, DEFAULT_LIMITS, limitsFrom } from "./limits";
import { evaluatePreGate, type PreGateInput } from "./pregate";
import { estimateUsage, estimateUsd, pricingFor } from "./pricing";
import { buildDraftPrompt, objectiveFrom } from "./prompts";

function base(over: Partial<PreGateInput> = {}): PreGateInput {
  return {
    message: "How does onboarding work?",
    doNotReply: false,
    aiTurnCount: 0,
    lastAiReplyAt: null,
    pipelineStage: "in_conversation",
    relationshipStage: "in_conversation",
    inboundCount: 1,
    outboundCount: 0,
    recentInbound: ["How does onboarding work?"],
    maxAiTurns: DEFAULT_LIMITS.maxAiTurns,
    cooldownMinutes: 0,
    now: new Date("2026-06-28T12:00:00.000Z"),
    ...over,
  };
}

test("pre-gate allows a genuine question", () => {
  assert.deepEqual(evaluatePreGate(base()), { disposition: "allow", reason: "ok" });
});

test("pre-gate skips low-signal acknowledgements (no LLM)", () => {
  for (const m of ["Thanks!", "👍", "got it", "perfect"]) {
    const d = evaluatePreGate(base({ message: m, recentInbound: [m] }));
    assert.equal(d.disposition, "skip", m);
    assert.equal(d.reason, "low_signal", m);
  }
});

test("pre-gate skips out-of-office auto-replies", () => {
  const d = evaluatePreGate(base({ message: "I am out of office until Monday, limited access to email." }));
  assert.equal(d.disposition, "skip");
  assert.equal(d.reason, "out_of_office");
});

test("opt-out and not-interested hard-stop (suppress)", () => {
  assert.deepEqual(evaluatePreGate(base({ message: "Please unsubscribe me" })), {
    disposition: "stop",
    reason: "unsubscribe",
  });
  assert.deepEqual(evaluatePreGate(base({ message: "Not interested, thanks" })), {
    disposition: "stop",
    reason: "not_interested",
  });
});

test("turn cap forces a handoff", () => {
  const d = evaluatePreGate(base({ aiTurnCount: 6, maxAiTurns: 6 }));
  assert.equal(d.disposition, "handoff");
  assert.equal(d.reason, "max_turns");
});

test("one-outbound-per-inbound skips an already-answered thread", () => {
  const d = evaluatePreGate(base({ inboundCount: 2, outboundCount: 2 }));
  assert.equal(d.disposition, "skip");
  assert.equal(d.reason, "already_answered");
});

test("cooldown skips a too-soon reply, allows after it elapses", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");
  const justNow = new Date(now.getTime() - 60_000).toISOString(); // 1 min ago
  assert.equal(
    evaluatePreGate(base({ cooldownMinutes: 30, lastAiReplyAt: justNow, now })).reason,
    "cooldown",
  );
  const longAgo = new Date(now.getTime() - 60 * 60_000).toISOString(); // 60 min ago
  assert.equal(
    evaluatePreGate(base({ cooldownMinutes: 30, lastAiReplyAt: longAgo, now })).disposition,
    "allow",
  );
});

test("loop detection stops repeated identical inbound", () => {
  const d = evaluatePreGate(base({ recentInbound: ["ping ping", "ping ping", "ping ping"] }));
  assert.equal(d.disposition, "stop");
  assert.equal(d.reason, "loop");
});

test("do_not_reply and closed threads skip", () => {
  assert.equal(evaluatePreGate(base({ doNotReply: true })).reason, "do_not_reply");
  assert.equal(evaluatePreGate(base({ pipelineStage: "booked" })).reason, "closed");
  assert.equal(evaluatePreGate(base({ relationshipStage: "closed_lost" })).reason, "closed");
});

test("limits parse + clamp; budget defaults uncapped", () => {
  assert.deepEqual(limitsFrom({ max_ai_turns: 3, cooldown_minutes: 15 }), {
    maxAiTurns: 3,
    cooldownMinutes: 15,
  });
  assert.deepEqual(limitsFrom(null), DEFAULT_LIMITS);
  assert.deepEqual(budgetFrom({}), { dailyUsdCap: null, alertAtPct: 0.8 });
  assert.equal(budgetFrom({ daily_usd_cap: 5, alert_at_pct: 0.5 }).dailyUsdCap, 5);
});

test("cost estimation is non-zero and model-priced", () => {
  const usage = estimateUsage({ prompt: "x".repeat(400), system: "y".repeat(40) }, "z".repeat(120));
  assert.ok(usage.totalTokens > 0);
  assert.ok(estimateUsd(usage, "gemini-2.0-flash") > 0);
  assert.equal(pricingFor("gemini-2.0-flash-001").inputPer1k, pricingFor("gemini-2.0-flash").inputPer1k);
});

// --- Phase 4: hot-lead detection, autonomy dial, AI disclosure ---------------

test("hot-lead detectors fire on buying signals, pricing, legal, competitor, high intent", () => {
  const sig = (message: string, projectedIntentScore = 0) =>
    detectHotLead({ intent: "question", projectedIntentScore, message });
  assert.deepEqual(sig("Send me a quote and let's move forward").reasons.includes("buying_signal"), true);
  assert.equal(detectBuyingSignal("ready to move forward"), true);
  assert.equal(sig("how much does it cost?").reasons.includes("pricing"), true);
  assert.equal(sig("can you share your DPA and SOC 2?").reasons.includes("legal"), true);
  assert.equal(sig("how do you compare to the alternative?").reasons.includes("competitor"), true);
  assert.equal(sig("just curious", 75).reasons.includes("high_intent"), true);
  assert.equal(detectHotLead({ intent: "meeting", projectedIntentScore: 0, message: "can we hop on a call" }).hot, true);
  // A plain feature question is NOT hot.
  assert.equal(detectHotLead({ intent: "question", projectedIntentScore: 5, message: "does it include priority support?" }).hot, false);
});

test("custom escalate-on guardrail triggers a hot lead", () => {
  const d = detectHotLead({ intent: "question", projectedIntentScore: 0, message: "what about HIPAA?", escalateOn: ["hipaa"] });
  assert.equal(d.reasons.includes("custom_guardrail"), true);
});

test("autonomy dial: approve_all never sends; auto_easy gates on grounded+confidence; full_auto sends", () => {
  const easy = (over: Partial<Parameters<typeof decideAutonomy>[0]>) =>
    decideAutonomy({ mode: "auto_easy_escalate_hard", confidence: 0.9, threshold: 0.7, grounded: true, inPolicy: true, ...over });
  assert.equal(decideAutonomy({ mode: "approve_all", confidence: 1, threshold: 0, grounded: true, inPolicy: true }).send, false);
  assert.equal(easy({}).send, true); // grounded + confident
  assert.equal(easy({ confidence: 0.5 }).reason, "low_confidence");
  assert.equal(easy({ grounded: false }).reason, "not_grounded");
  assert.equal(decideAutonomy({ mode: "full_auto", confidence: 0, threshold: 0.9, grounded: false, inPolicy: true }).send, true);
  assert.equal(decideAutonomy({ mode: "full_auto", confidence: 1, threshold: 0, grounded: true, inPolicy: false }).send, false);
});

test("AI-identity detection returns the fixed honest disclosure", () => {
  assert.equal(detectAiIdentityQuestion("wait, are you a bot?"), true);
  assert.equal(detectAiIdentityQuestion("am I talking to a real person?"), true);
  assert.equal(detectAiIdentityQuestion("what's your pricing?"), false);
  assert.match(AI_IDENTITY_RESPONSE, /AI assistant/);
  assert.match(AI_IDENTITY_RESPONSE, /real person/);
});

// --- Campaign context: offer field + grounded draft prompt -------------------

test("objectiveFrom parses + trims the offer field", () => {
  const o = objectiveFrom({ goal: "g", offer: "  A safe outreach tool  ", success_criteria: "demo", cta: "call?" });
  assert.equal(o.offer, "A safe outreach tool");
  assert.equal(o.goal, "g");
});

test("draft prompt grounds in knowledge and includes the offer + never-invent rule", () => {
  const input = buildDraftPrompt({
    action: "answer",
    lastMessage: "what's the price?",
    chunks: ["Pricing starts at $99/mo per seat."],
    facts: [],
    summary: null,
    history: [],
    objective: {
      goal: "book a demo",
      offer: "LinkedIn outreach that stays account-safe",
      success_criteria: "a booked call",
      cta: "grab a call?",
    },
    guardrails: { never_discuss: ["competitor names"] },
    voice: { tone: "warm" },
  });
  // The offer + success criteria are injected as positioning context...
  assert.match(input.prompt, /What you're offering: LinkedIn outreach that stays account-safe/);
  assert.match(input.prompt, /What a win looks like: a booked call/);
  // ...and the retrieved chunk is the ONLY factual source, with a never-invent rule.
  assert.match(input.prompt, /KNOWLEDGE \(your only source of facts\)/);
  assert.match(input.prompt, /Pricing starts at \$99/);
  assert.match(input.system ?? "", /NEVER invent/);
  assert.match(input.system ?? "", /Never discuss: competitor names/);
});

test("handoff summary includes who, why, intent, and a next step", () => {
  const s = buildHandoffSummary({
    name: "Dana Lee",
    headline: "VP Sales at Acme",
    company: "Acme",
    role: "VP Sales",
    intent: "interested",
    intentScore: 72,
    reasons: ["buying_signal"],
    facts: ["Team of 12 SDRs"],
    recentMessages: [{ direction: "inbound", body: "send me a quote" }],
    lastMessage: "send me a quote",
  });
  assert.match(s.text, /Hot lead — Dana Lee/);
  assert.match(s.text, /score 72/);
  assert.ok(s.nextStep.length > 0);
});
