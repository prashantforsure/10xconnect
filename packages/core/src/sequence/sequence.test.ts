import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type SequenceGraphNode, validateSequenceGraph } from "./validate-graph";

const action = (id: string, next: string | null = null, type = "send_message"): SequenceGraphNode => ({
  id,
  kind: "action",
  type,
  next,
});

const condition = (
  id: string,
  t: string | null = null,
  f: string | null = null,
  type = "invite_accepted",
): SequenceGraphNode => ({ id, kind: "condition", type, true: t, false: f });

describe("validateSequenceGraph", () => {
  it("accepts an empty graph", () => {
    const v = validateSequenceGraph([]);
    assert.equal(v.ok, true);
    assert.equal(v.errors.length, 0);
  });

  it("accepts a linear chain", () => {
    const v = validateSequenceGraph([action("a", "b", "like_last_post"), action("b", "c"), action("c")]);
    assert.equal(v.ok, true);
    assert.equal(v.errors.length, 0);
    assert.equal(v.warnings.length, 0);
  });

  it("accepts a branching graph (canonical default sequence)", () => {
    const v = validateSequenceGraph([
      action("like", "cr", "like_last_post"),
      { id: "cr", kind: "action", type: "send_connection_request", next: "cond" },
      condition("cond", "msg", "nurture"),
      action("msg", null),
      action("nurture", null, "visit_profile"),
    ]);
    assert.equal(v.ok, true);
  });

  it("rejects duplicate ids", () => {
    const v = validateSequenceGraph([action("a", "b"), action("a"), action("b")]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "duplicate_id"));
  });

  it("rejects unknown node types", () => {
    const v = validateSequenceGraph([{ id: "a", kind: "action", type: "hack_the_planet", next: null }]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "unknown_type"));
  });

  it("rejects email nodes with a specific message until Phase 11", () => {
    const v = validateSequenceGraph([{ id: "a", kind: "action", type: "send_email", next: null }]);
    assert.equal(v.ok, false);
    const issue = v.errors.find((e) => e.code === "email_not_supported");
    assert.ok(issue);
    assert.match(issue.message, /aren't supported yet/);
  });

  it("rejects dangling next/true/false refs", () => {
    const v = validateSequenceGraph([action("a", "ghost")]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "dangling_ref" && e.nodeId === "a"));

    const v2 = validateSequenceGraph([condition("c", "ghost", null)]);
    assert.equal(v2.ok, false);
    assert.ok(v2.errors.some((e) => e.code === "dangling_ref"));
  });

  it("rejects a full cycle (no root)", () => {
    const v = validateSequenceGraph([action("a", "b"), action("b", "a")]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "cycle"));
  });

  it("rejects a cycle behind a root", () => {
    // a -> b -> c -> b
    const v = validateSequenceGraph([action("a", "b"), action("b", "c"), action("c", "b")]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "cycle"));
  });

  it("rejects a cycle through a condition branch", () => {
    const v = validateSequenceGraph([action("a", "cond"), condition("cond", "b", null), action("b", "cond")]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "cycle"));
  });

  it("rejects disconnected components (multiple roots)", () => {
    const v = validateSequenceGraph([action("a", "b"), action("b"), action("x", "y"), action("y")]);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.code === "multiple_roots"));
  });

  it("warns (not errors) on a condition with both branches ended", () => {
    const v = validateSequenceGraph([action("a", "cond"), condition("cond", null, null)]);
    assert.equal(v.ok, true);
    assert.ok(v.warnings.some((w) => w.code === "condition_dead_end"));
  });

  it("warns on an action node carrying branch edges", () => {
    const v = validateSequenceGraph([
      { id: "a", kind: "action", type: "send_message", next: "b", true: "b" },
      action("b"),
    ]);
    assert.equal(v.ok, true);
    assert.ok(v.warnings.some((w) => w.code === "action_with_branches"));
  });

  it("accepts a diamond (two branches converging) without a false cycle", () => {
    // cond -true-> x -> tail ; cond -false-> y -> tail
    const v = validateSequenceGraph([
      condition("cond", "x", "y"),
      action("x", "tail"),
      action("y", "tail"),
      action("tail"),
    ]);
    assert.equal(v.ok, true);
    assert.equal(v.errors.length, 0);
  });
});
