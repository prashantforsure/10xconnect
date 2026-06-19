import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOWED_ACTION_TYPES,
  ALLOWED_CONDITION_TYPES,
  applyRefinement,
  deterministicGraph,
  enforceSafety,
  type GenerateIntake,
  type GenNode,
  parseGeneratedGraph,
} from "./index";

const intake: GenerateIntake = {
  offer: "fractional RevOps",
  audience: "seed-stage SaaS founders",
  goal: "book intro calls",
  tone: "balanced",
};

function allTypesAllowed(nodes: GenNode[]): boolean {
  return nodes.every((n) =>
    n.kind === "condition" ? ALLOWED_CONDITION_TYPES.has(n.type) : ALLOWED_ACTION_TYPES.has(n.type),
  );
}

test("deterministicGraph produces a valid, safe sequence with a no-note connection request", () => {
  const g = deterministicGraph(intake);
  assert.ok(g.length >= 4);
  assert.ok(allTypesAllowed(g));
  const conn = g.find((n) => n.type === "send_connection_request");
  assert.ok(conn);
  assert.equal(conn?.config.note, undefined); // no-note default
  // message nodes carry a structured body + tuned AI prompt
  const msg = g.find((n) => n.type === "send_message" && n.config.messageBody);
  assert.ok(msg);
  assert.ok(typeof msg?.config.aiPrompt === "string");
});

test("tone changes aggressiveness (gentle adds warm-up + no InMail; aggressive adds InMail)", () => {
  const gentle = deterministicGraph({ ...intake, tone: "gentle" });
  const aggressive = deterministicGraph({ ...intake, tone: "aggressive" });
  assert.equal(gentle.some((n) => n.type === "inmail"), false);
  assert.equal(aggressive.some((n) => n.type === "inmail"), true);
});

test("enforceSafety drops unknown node types and strips connection notes + clamps waits", () => {
  const dirty: GenNode[] = [
    { kind: "action", type: "send_connection_request", config: { note: "hi there" } },
    { kind: "action", type: "send_sms", config: {} }, // invalid → dropped
    { kind: "action", type: "wait_x_days", config: { days: 999 } },
  ];
  const safe = enforceSafety(dirty);
  assert.equal(safe.length, 2);
  assert.equal(safe[0].config.note, undefined);
  assert.equal(safe[1].config.days, 90); // clamped
});

test("parseGeneratedGraph repairs LLM JSON and falls back when unusable", () => {
  const good = parseGeneratedGraph(
    'noise {"nodes":[{"kind":"action","type":"send_connection_request","config":{"note":"x"}},{"kind":"action","type":"send_message","config":{"body":"Hi {first_name}"}}]} trailing',
    intake,
  );
  assert.ok(allTypesAllowed(good));
  assert.equal(good.find((n) => n.type === "send_connection_request")?.config.note, undefined);

  const fallback = parseGeneratedGraph("not json at all", intake);
  assert.ok(fallback.length >= 4); // deterministic fallback
});

test("applyRefinement patches the graph in place (add voice, remove inmail, gentler)", () => {
  const base = deterministicGraph({ ...intake, tone: "aggressive" });
  assert.equal(applyRefinement(base, "remove the inmail").some((n) => n.type === "inmail"), false);
  assert.equal(
    applyRefinement(base, "add a voice note").some((n) => n.type === "send_voice_note"),
    true,
  );
  const gentler = applyRefinement(base, "make it gentler");
  assert.equal(gentler.some((n) => n.type === "inmail"), false);
});
