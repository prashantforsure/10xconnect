import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOWED_ACTION_TYPES,
  ALLOWED_CONDITION_TYPES,
  type CampaignBlueprint,
  clarifyingQuestions,
  computeRequiredInputs,
  deterministicBlueprint,
  type GenerateIntake,
  launchReadiness,
  parseBlueprint,
} from "./index";

const intake: GenerateIntake = {
  offer: "fractional RevOps for seed-stage teams",
  audience: "seed-stage SaaS founders",
  goal: "book intro calls",
  tone: "balanced",
};

function graphIsValid(b: CampaignBlueprint): boolean {
  return (
    b.graph.length >= 2 &&
    b.graph.every((n) =>
      n.kind === "condition" ? ALLOWED_CONDITION_TYPES.has(n.type) : ALLOWED_ACTION_TYPES.has(n.type),
    )
  );
}

const VALID_AUTONOMY = new Set(["approve_all", "auto_easy_escalate_hard", "full_auto"]);

test("deterministicBlueprint emits a SCHEMA-VALID full campaign (graph + brain + KB seed)", () => {
  const b = deterministicBlueprint(intake);

  // Graph: only known node types, no-note connection request.
  assert.ok(graphIsValid(b));
  const conn = b.graph.find((n) => n.type === "send_connection_request");
  assert.equal(conn?.config.note, undefined);

  // Brain: objective filled, valid autonomy, escalate-on guardrails present.
  assert.ok(b.objective.goal.length > 0 && b.objective.icp.length > 0);
  assert.ok(b.objective.success_criteria.length > 0 && b.objective.cta.length > 0);
  assert.ok(VALID_AUTONOMY.has(b.autonomy.mode));
  assert.ok(b.autonomy.confidence_threshold >= 0 && b.autonomy.confidence_threshold <= 1);
  assert.ok(b.guardrails.escalate_on.includes("pricing"), "pricing escalates by default (needs a human + facts)");

  // KB seed: STRUCTURE only — every section is a title + a guiding prompt, no facts.
  assert.ok(b.knowledgeSeed.sections.length >= 3);
  assert.ok(b.knowledgeSeed.sections.every((s) => s.title.length > 0 && s.prompt.length > 0));

  // Required inputs: grounding required for an AI-bearing sequence; sender+contacts always.
  const kb = b.requiredInputs.find((r) => r.key === "knowledge_base");
  assert.equal(kb?.required, true, "knowledge base is required (the graph has AI chips)");
  assert.equal(b.requiredInputs.find((r) => r.key === "sender_account")?.required, true);
  assert.equal(b.requiredInputs.find((r) => r.key === "contacts")?.required, true);
});

test("parseBlueprint REPAIRS invalid model output (drops bad node types, clamps autonomy, strips KB facts)", () => {
  const raw = JSON.stringify({
    objective: { goal: "", icp: "ops leaders" },
    guardrails: { escalate_on: ["pricing"] },
    voice: { tone: "warm" },
    autonomy: { mode: "yolo_send_everything", confidence_threshold: 5 }, // invalid
    graph: [
      { kind: "action", type: "send_connection_request", config: { note: "hi" } },
      { kind: "action", type: "send_sms", config: {} }, // invalid → dropped
      { kind: "action", type: "send_message", config: { body: "Hi {first_name}", aiPrompt: "x" } },
    ],
    knowledgeSeed: {
      name: "KB",
      sections: [{ title: "Pricing", prompt: "tiers", content: "Pro is $99/mo" }], // content must NOT survive
    },
  });

  const b = parseBlueprint(raw, intake);

  assert.ok(graphIsValid(b), "graph repaired to known types only");
  assert.equal(b.graph.some((n) => n.type === "send_sms"), false, "unknown node dropped");
  assert.equal(b.graph.find((n) => n.type === "send_connection_request")?.config.note, undefined);

  // Autonomy clamped to a known mode + a valid threshold.
  assert.ok(VALID_AUTONOMY.has(b.autonomy.mode));
  assert.ok(b.autonomy.confidence_threshold >= 0 && b.autonomy.confidence_threshold <= 1);

  // Objective backfilled from the deterministic fallback when the model left it empty.
  assert.ok(b.objective.goal.length > 0);

  // KB seed kept ONLY title + prompt — no model-supplied "content"/facts leaked.
  const section = b.knowledgeSeed.sections.find((s) => s.title === "Pricing");
  assert.ok(section);
  assert.deepEqual(Object.keys(section!).sort(), ["prompt", "title"]);
  assert.equal((section as { content?: unknown }).content, undefined);
});

test("parseBlueprint falls back to a valid blueprint on unusable output", () => {
  const b = parseBlueprint("not json at all", intake);
  assert.ok(graphIsValid(b));
  assert.ok(b.knowledgeSeed.sections.length >= 3);
});

test("clarifyingQuestions asks 1–2 questions when under-specified, none when complete", () => {
  const thin: GenerateIntake = { offer: "stuff", audience: "people", goal: "x", tone: "balanced" };
  const qs = clarifyingQuestions(thin);
  assert.ok(qs.length >= 1 && qs.length <= 2, "1–2 clarifying questions for a thin intake");

  assert.deepEqual(clarifyingQuestions(intake), [], "a specific intake needs no clarification");
});

test("launchReadiness BLOCKS launch until grounding (+ sender + contacts) is supplied", () => {
  const required = computeRequiredInputs(deterministicBlueprint(intake).graph);

  // Nothing supplied → not ready; knowledge_base is among the missing.
  const empty = launchReadiness(required, {});
  assert.equal(empty.ready, false);
  assert.ok(empty.missing.some((r) => r.key === "knowledge_base"), "grounding is required before launch");

  // Sender + contacts but NO grounding → still blocked.
  const noKb = launchReadiness(required, { sender_account: true, contacts: true });
  assert.equal(noKb.ready, false, "still blocked without grounding");

  // Every required input supplied → ready (the balanced graph also needs a voice profile).
  const allProvided = Object.fromEntries(required.map((r) => [r.key, true]));
  const ready = launchReadiness(required, allProvided);
  assert.equal(ready.ready, true);
});
