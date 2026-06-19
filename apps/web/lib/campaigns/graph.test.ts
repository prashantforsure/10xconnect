import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendChainAtTail,
  byId,
  changeNodeType,
  createNode,
  type GraphNode,
  insertNodeAtEdge,
  moveNode,
  parentEdge,
  pruneUnreachable,
  removeNode,
  rootId,
  toSavePayload,
} from "./graph";

/** Build a simple linear chain a -> b -> c of action nodes. */
function linear(): GraphNode[] {
  const a = createNode("action", "like_last_post");
  const b = createNode("action", "send_connection_request");
  const c = createNode("action", "send_message");
  a.next = b.id;
  b.next = c.id;
  return [a, b, c];
}

test("rootId finds the unparented entry node", () => {
  const nodes = linear();
  assert.equal(rootId(nodes), nodes[0].id);
  assert.equal(rootId([]), null);
});

test("insertNodeAtEdge mid-chain inserts an action without losing downstream", () => {
  const nodes = linear();
  const [a, b] = nodes;
  const wait = createNode("action", "wait_x_days", { days: 2 });
  const out = insertNodeAtEdge(nodes, { parentId: a.id, slot: "next" }, wait);
  const map = byId(out);
  assert.equal(map.get(a.id)?.next, wait.id, "a now points to the inserted node");
  assert.equal(map.get(wait.id)?.next, b.id, "inserted node continues to old downstream");
  assert.equal(out.length, 4);
});

test("inserting a condition forks: downstream moves to true, false opens empty", () => {
  const nodes = linear();
  const [a, b] = nodes;
  const cond = createNode("condition", "is_first_level");
  const out = insertNodeAtEdge(nodes, { parentId: a.id, slot: "next" }, cond);
  const placed = byId(out).get(cond.id) as GraphNode;
  assert.equal(byId(out).get(a.id)?.next, cond.id);
  assert.equal(placed.true, b.id, "existing chain becomes the true branch");
  assert.equal(placed.false, null, "false branch starts empty (End of sequence)");
});

test("insert at the root edge makes the new node the root", () => {
  const nodes = linear();
  const oldRoot = rootId(nodes);
  const visit = createNode("action", "visit_profile");
  const out = insertNodeAtEdge(nodes, { parentId: null, slot: "next" }, visit);
  assert.equal(rootId(out), visit.id);
  assert.equal(byId(out).get(visit.id)?.next, oldRoot);
});

test("appendChainAtTail attaches a pre-wired branch at an empty slot", () => {
  const nodes = linear();
  const cond = createNode("condition", "is_first_level");
  let out = insertNodeAtEdge(nodes, { parentId: nodes[2].id, slot: "next" }, cond);
  // The false branch is empty; append a single message there.
  const msg = createNode("action", "send_message");
  out = appendChainAtTail(out, { parentId: cond.id, slot: "false" }, [msg]);
  assert.equal(byId(out).get(cond.id)?.false, msg.id);
});

test("removeNode heals edges and prunes the dropped false subtree", () => {
  const nodes = linear();
  const [a, b] = nodes;
  const cond = createNode("condition", "invite_accepted");
  let out = insertNodeAtEdge(nodes, { parentId: a.id, slot: "next" }, cond);
  // false branch gets a node that should be pruned when the condition is removed.
  const dead = createNode("action", "follow_lead");
  out = appendChainAtTail(out, { parentId: cond.id, slot: "false" }, [dead]);

  out = removeNode(out, cond.id);
  assert.equal(byId(out).get(a.id)?.next, b.id, "a reconnects to the condition's true branch");
  assert.equal(byId(out).get(cond.id), undefined, "condition removed");
  assert.equal(byId(out).get(dead.id), undefined, "orphaned false branch pruned");
});

test("removeNode on the root promotes its continuation to root", () => {
  const nodes = linear();
  const out = removeNode(nodes, nodes[0].id);
  assert.equal(rootId(out), nodes[1].id);
  assert.equal(out.length, 2);
});

test("moveNode swaps adjacent action nodes both ways", () => {
  const nodes = linear();
  const [a, b, c] = nodes;
  // Move b down past c.
  const down = moveNode(nodes, b.id, 1);
  let map = byId(down);
  assert.equal(map.get(a.id)?.next, c.id);
  assert.equal(map.get(c.id)?.next, b.id);
  assert.equal(map.get(b.id)?.next, null);

  // Move c up past a (now first after move? test independent): move b up past a.
  const up = moveNode(nodes, b.id, -1);
  map = byId(up);
  assert.equal(rootId(up), b.id, "b becomes root after moving up past a");
  assert.equal(map.get(b.id)?.next, a.id);
  assert.equal(map.get(a.id)?.next, c.id);
});

test("moveNode is a no-op across a fork (won't tangle branches)", () => {
  const cond = createNode("condition", "is_first_level");
  const msg = createNode("action", "send_message");
  cond.true = msg.id;
  const nodes = [cond, msg];
  assert.deepEqual(moveNode(nodes, msg.id, -1), nodes, "can't move across the condition");
});

test("changeNodeType swaps type + config in place", () => {
  const nodes = linear();
  const out = changeNodeType(nodes, nodes[2].id, "inmail", { subject: "hi", body: "x" });
  const n = byId(out).get(nodes[2].id) as GraphNode;
  assert.equal(n.type, "inmail");
  assert.deepEqual(n.config, { subject: "hi", body: "x" });
});

test("toSavePayload prunes orphans and syncs delayDays", () => {
  const nodes = linear();
  const [a] = nodes;
  // A reachable wait node (delayDays should sync to config.days) ...
  const wait = createNode("action", "wait_x_days", { days: 5 });
  let graph = insertNodeAtEdge(nodes, { parentId: a.id, slot: "next" }, wait);
  // ... plus an unreachable orphan that must be pruned.
  graph = [...graph, createNode("action", "like_last_post")];

  const out = toSavePayload(graph);
  assert.equal(out.length, 4, "orphan pruned, chain + wait kept");
  assert.equal(out.find((n) => n.id === wait.id)?.delayDays, 5, "wait delayDays synced from config");
  assert.ok(out.every((n) => (n.type === "wait_x_days") === (n.delayDays !== null)));
});

test("parentEdge reports the slot pointing at a node", () => {
  const nodes = linear();
  assert.deepEqual(parentEdge(nodes, nodes[1].id), { parentId: nodes[0].id, slot: "next" });
  assert.equal(parentEdge(nodes, nodes[0].id), null);
});

test("pruneUnreachable keeps a full forked graph intact", () => {
  const cond = createNode("condition", "is_first_level");
  const t = createNode("action", "send_message");
  const f = createNode("action", "send_connection_request");
  cond.true = t.id;
  cond.false = f.id;
  const out = pruneUnreachable([cond, t, f]);
  assert.equal(out.length, 3);
});
