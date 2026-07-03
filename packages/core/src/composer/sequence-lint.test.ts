// Sequence-timing lint (advisory pacing guardrails). Pure graph walk — these
// tests build small builder-shaped graphs by hand.

import assert from "node:assert/strict";
import { test } from "node:test";

import { lintSequenceTiming, type SequenceLintNode } from "./sequence-lint";

let seq = 0;
function node(partial: Partial<SequenceLintNode> & { type: string }): SequenceLintNode {
  seq += 1;
  return {
    id: partial.id ?? `n${seq}`,
    kind: partial.kind ?? "action",
    config: {},
    next: null,
    true: null,
    false: null,
    delayDays: null,
    ...partial,
  };
}

function chain(...nodes: SequenceLintNode[]): SequenceLintNode[] {
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].kind === "action") nodes[i].next = nodes[i + 1].id;
  }
  return nodes;
}

const ids = (nodes: SequenceLintNode[]): string[] => lintSequenceTiming(nodes).map((f) => f.id);

test("warns when a message follows a connection request under 7 days", () => {
  const graph = chain(
    node({ type: "send_connection_request" }),
    node({ type: "wait_x_days", config: { days: 3 }, delayDays: 3 }),
    node({ type: "send_message" }),
  );
  const findings = lintSequenceTiming(graph);
  const hit = findings.find((f) => f.id === "short_wait_after_connection");
  assert.ok(hit, "short wait flagged");
  assert.match(hit.message, /7–12 days/);
  assert.equal(hit.nodeId, graph[2].id, "finding points at the send");
});

test("quiet when the wait is 7+ days or the follow-up is gated by invite_accepted", () => {
  const longWait = chain(
    node({ type: "send_connection_request" }),
    node({ type: "wait_x_days", config: { days: 7 }, delayDays: 7 }),
    node({ type: "send_message" }),
  );
  assert.ok(!ids(longWait).includes("short_wait_after_connection"));

  // Canonical template shape: request → invite_accepted? → message on accept.
  const msg = node({ type: "send_message" });
  const gate = node({ kind: "condition", type: "invite_accepted", true: msg.id, false: null });
  const req = node({ type: "send_connection_request", next: gate.id });
  assert.ok(!ids([req, gate, msg]).includes("short_wait_after_connection"));
});

test("warns on back-to-back messages under 2 days apart, including across branches", () => {
  const tight = chain(
    node({ type: "send_message" }),
    node({ type: "wait_x_days", config: { days: 1 }, delayDays: 1 }),
    node({ type: "send_voice_note" }),
  );
  assert.ok(ids(tight).includes("messages_too_close"));

  const spaced = chain(
    node({ type: "send_message" }),
    node({ type: "wait_x_days", config: { days: 3 }, delayDays: 3 }),
    node({ type: "send_voice_note" }),
  );
  assert.ok(!ids(spaced).includes("messages_too_close"));

  // Condition branches are walked: the immediate message on the false branch fires.
  const fastMsg = node({ type: "send_message" });
  const cond = node({ kind: "condition", type: "message_replied", true: null, false: fastMsg.id });
  const first = node({ type: "send_message", next: cond.id });
  const findings = lintSequenceTiming([first, cond, fastMsg]);
  assert.ok(findings.some((f) => f.id === "messages_too_close" && f.nodeId === fastMsg.id));
});

test("clean sequences and cyclic graphs produce no findings / no hang", () => {
  assert.equal(lintSequenceTiming([]).length, 0);
  const clean = chain(
    node({ type: "like_last_post" }),
    node({ type: "send_connection_request" }),
    node({ type: "wait_x_days", config: { days: 10 }, delayDays: 10 }),
    node({ type: "send_message" }),
  );
  assert.equal(lintSequenceTiming(clean).length, 0);

  // Cycle: a → b → a. Must terminate.
  const a = node({ type: "visit_profile" });
  const b = node({ type: "like_last_post", next: a.id });
  a.next = b.id;
  assert.equal(lintSequenceTiming([a, b]).length, 0);
});
