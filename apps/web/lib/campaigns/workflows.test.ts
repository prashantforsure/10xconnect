import assert from "node:assert/strict";
import { test } from "node:test";

import { reachableIds, remapIds, rootId } from "./graph";
import { PREBUILT_WORKFLOWS } from "./workflows";

test("every prebuilt workflow builds a valid, fully-reachable graph", () => {
  assert.ok(PREBUILT_WORKFLOWS.length > 0, "there are prebuilt workflows");
  for (const wf of PREBUILT_WORKFLOWS) {
    const g = wf.build();
    assert.ok(g.length > 0, `${wf.key} non-empty`);
    const root = rootId(g);
    assert.ok(root, `${wf.key} has a root`);
    // No orphans: every node is reachable from the root.
    assert.equal(reachableIds(g).size, g.length, `${wf.key} all nodes reachable`);
    // Every edge target points at a real node.
    const ids = new Set(g.map((n) => n.id));
    for (const n of g) {
      for (const e of [n.next, n.true, n.false]) {
        if (e) {
          assert.ok(ids.has(e), `${wf.key} edge target ${e} exists`);
        }
      }
    }
  }
});

test("classic connector has the canonical node order", () => {
  const wf = PREBUILT_WORKFLOWS.find((w) => w.key === "classic_connector");
  assert.ok(wf, "classic connector exists");
  const types = wf.build().map((n) => n.type);
  assert.deepEqual(types, [
    "like_last_post",
    "send_connection_request",
    "invite_accepted",
    "wait_x_days",
    "send_message",
  ]);
});

test("connected vs not connected forks on is_first_level (both branches wired)", () => {
  const wf = PREBUILT_WORKFLOWS.find((w) => w.key === "connected_vs_not");
  assert.ok(wf, "connected vs not exists");
  const g = wf.build();
  const cond = g.find((n) => n.type === "is_first_level");
  assert.ok(cond, "has the is_first_level condition");
  assert.ok(cond.true && cond.false, "both branches are wired");
});

test("build() returns fresh ids each call (no shared mutable state)", () => {
  const a = PREBUILT_WORKFLOWS[0].build();
  const b = PREBUILT_WORKFLOWS[0].build();
  const aIds = new Set(a.map((n) => n.id));
  assert.ok(
    b.every((n) => !aIds.has(n.id)),
    "two builds never share node ids",
  );
});

test("remapIds re-ids a graph while preserving its structure", () => {
  const g = PREBUILT_WORKFLOWS.find((w) => w.key === "connected_vs_not")!.build();
  const r = remapIds(g);
  assert.equal(r.length, g.length, "same node count");
  // Same root type, fully reachable, but all ids changed.
  const gRoot = g.find((n) => n.id === rootId(g));
  const rRoot = r.find((n) => n.id === rootId(r));
  assert.equal(gRoot?.type, rRoot?.type, "root type preserved");
  assert.equal(reachableIds(r).size, r.length, "remapped graph stays fully reachable");
  const gIds = new Set(g.map((n) => n.id));
  assert.ok(
    r.every((n) => !gIds.has(n.id)),
    "all ids remapped to fresh values",
  );
});
