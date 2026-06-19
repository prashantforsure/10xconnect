// Pure, immutable graph helpers for the visual branching builder. The builder's
// component state is a flat GraphNode[] that maps 1:1 to the load/save payload
// (GET/PUT /campaigns/:id/sequence). Actions chain via `next`; conditions fork
// via `true` / `false`. wait_x_days is an action rendered as a connector pill.
//
// Every function returns a NEW array (no mutation) so React state updates stay
// predictable. The engine already executes true/false branches (campaign-runner
// nextNodeId) — this module just lets the UI build + persist them.

export interface GraphNode {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
  next: string | null;
  true: string | null;
  false: string | null;
  delayDays: number | null;
}

/** An attachment point in the graph: a slot on a parent node, or the root. */
export interface Edge {
  /** null = the root edge (the chain entry point). */
  parentId: string | null;
  slot: "next" | "true" | "false";
}

let localCounter = 0;
/** Stable-enough local id for unsaved nodes; the server remaps to uuids on save. */
export function localId(): string {
  localCounter += 1;
  return `n${Date.now()}_${localCounter}`;
}

export function byId(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** The root node id = the one no edge points to (the chain entry). */
export function rootId(nodes: GraphNode[]): string | null {
  if (nodes.length === 0) {
    return null;
  }
  const targeted = new Set<string>();
  for (const n of nodes) {
    for (const e of [n.next, n.true, n.false]) {
      if (e) {
        targeted.add(e);
      }
    }
  }
  return nodes.find((n) => !targeted.has(n.id))?.id ?? nodes[0].id;
}

/** The node id currently attached at `edge` (or the current root for a root edge). */
export function childAt(nodes: GraphNode[], edge: Edge): string | null {
  if (edge.parentId === null) {
    return rootId(nodes);
  }
  const parent = byId(nodes).get(edge.parentId);
  return parent ? parent[edge.slot] : null;
}

/** A condition's continuation slot is `true`; an action's is `next`. */
function continuationSlot(node: GraphNode): "next" | "true" {
  return node.kind === "condition" ? "true" : "next";
}

function setEdge(nodes: GraphNode[], parentId: string, slot: Edge["slot"], childId: string | null): GraphNode[] {
  return nodes.map((n) => (n.id === parentId ? { ...n, [slot]: childId } : n));
}

export function createNode(
  kind: "action" | "condition",
  type: string,
  config: Record<string, unknown> = {},
): GraphNode {
  const cfg = type === "wait_x_days" ? { days: 3, ...config } : config;
  return {
    id: localId(),
    kind,
    type,
    config: cfg,
    next: null,
    true: null,
    false: null,
    delayDays: type === "wait_x_days" ? Number(cfg.days) || 1 : null,
  };
}

/**
 * Insert a single node at `edge`, preserving whatever was downstream by wiring it
 * into the new node's continuation slot. Inserting a CONDITION mid-chain pushes
 * the existing downstream into its `true` branch and opens an empty `false` branch
 * — i.e. the canvas forks (CLAUDE.md §7).
 */
export function insertNodeAtEdge(nodes: GraphNode[], edge: Edge, node: GraphNode): GraphNode[] {
  const downstream = childAt(nodes, edge);
  const wired: GraphNode =
    node.kind === "condition"
      ? { ...node, true: downstream, false: null }
      : { ...node, next: downstream };
  let out = [...nodes, wired];
  if (edge.parentId !== null) {
    out = setEdge(out, edge.parentId, edge.slot, wired.id);
  }
  // For a root edge, `wired` is automatically the new root: nothing points to it,
  // and the previous root is now targeted by wired's continuation.
  return out;
}

/**
 * Append a pre-wired chain (e.g. a template) at a TAIL edge (one whose child is
 * null — an "End of sequence" point). `chain[0]` is the entry; the chain's own
 * internal edges are kept as-is, so a branching template lands intact.
 */
export function appendChainAtTail(nodes: GraphNode[], edge: Edge, chain: GraphNode[]): GraphNode[] {
  if (chain.length === 0) {
    return nodes;
  }
  let out = [...nodes, ...chain];
  if (edge.parentId !== null) {
    out = setEdge(out, edge.parentId, edge.slot, chain[0].id);
  }
  return out;
}

/**
 * Insert a pre-wired chain (template) at `edge`, attaching whatever was downstream
 * to the chain's designated `tailNodeId.next` so the user's existing steps are
 * preserved on the template's main path. `entryId` is the chain's first node.
 * Branch tails inside the chain that aren't the main tail simply end (× End).
 */
export function insertChainAtEdge(
  nodes: GraphNode[],
  edge: Edge,
  chain: GraphNode[],
  entryId: string,
  tailNodeId: string,
): GraphNode[] {
  const downstream = childAt(nodes, edge);
  let out = [...nodes, ...chain];
  if (downstream) {
    out = out.map((n) => (n.id === tailNodeId ? { ...n, next: downstream } : n));
  }
  if (edge.parentId !== null) {
    out = setEdge(out, edge.parentId, edge.slot, entryId);
  }
  // For a root edge `entryId` becomes the root automatically (downstream/old root
  // is now reached through the chain's tail).
  return pruneUnreachable(out);
}

/** Reachable node ids from the root (BFS over next/true/false). */
export function reachableIds(nodes: GraphNode[]): Set<string> {
  const map = byId(nodes);
  const seen = new Set<string>();
  const root = rootId(nodes);
  const stack = root ? [root] : [];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const n = map.get(id);
    if (!n) {
      continue;
    }
    for (const e of [n.next, n.true, n.false]) {
      if (e && !seen.has(e)) {
        stack.push(e);
      }
    }
  }
  return seen;
}

/** Drop nodes no longer reachable from the root (e.g. an abandoned branch subtree). */
export function pruneUnreachable(nodes: GraphNode[]): GraphNode[] {
  if (nodes.length === 0) {
    return nodes;
  }
  const keep = reachableIds(nodes);
  return nodes.filter((n) => keep.has(n.id));
}

/**
 * Remove a node, healing the graph: edges that pointed at it are redirected to its
 * continuation (an action's `next`, a condition's `true` branch — the `false`
 * subtree is then pruned as unreachable).
 */
export function removeNode(nodes: GraphNode[], id: string): GraphNode[] {
  const node = byId(nodes).get(id);
  if (!node) {
    return nodes;
  }
  const continuation = node[continuationSlot(node)];
  const redirected = nodes
    .filter((n) => n.id !== id)
    .map((n) => {
      let m = n;
      if (m.next === id) m = { ...m, next: continuation };
      if (m.true === id) m = { ...m, true: continuation };
      if (m.false === id) m = { ...m, false: continuation };
      return m;
    });
  return pruneUnreachable(redirected);
}

/** Replace a node's config (used by inline fields + the composer). */
export function setNodeConfig(
  nodes: GraphNode[],
  id: string,
  config: Record<string, unknown>,
): GraphNode[] {
  return nodes.map((n) =>
    n.id === id
      ? { ...n, config, delayDays: n.type === "wait_x_days" ? Number(config.days) || 1 : n.delayDays }
      : n,
  );
}

/** Change a node's action type (composer "Change action"), pruning stale config. */
export function changeNodeType(
  nodes: GraphNode[],
  id: string,
  type: string,
  nextConfig: Record<string, unknown>,
): GraphNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, type, config: nextConfig } : n));
}

/** The edge that points at `id` (its parent slot), or null if `id` is the root. */
export function parentEdge(nodes: GraphNode[], id: string): Edge | null {
  for (const n of nodes) {
    if (n.next === id) return { parentId: n.id, slot: "next" };
    if (n.true === id) return { parentId: n.id, slot: "true" };
    if (n.false === id) return { parentId: n.id, slot: "false" };
  }
  return null;
}

/**
 * Swap a node with its neighbour in the SAME linear segment (reorder up/down).
 * Only swaps two adjacent ACTION nodes that aren't across a fork — a no-op
 * otherwise, so reordering never tangles a branch.
 */
export function moveNode(nodes: GraphNode[], id: string, dir: -1 | 1): GraphNode[] {
  const map = byId(nodes);
  const node = map.get(id);
  if (!node || node.kind !== "action") {
    return nodes;
  }

  if (dir === 1) {
    // Swap `node` with its successor `b` (node.next === b).
    const b = node.next ? map.get(node.next) : undefined;
    if (!b || b.kind !== "action") {
      return nodes;
    }
    const pe = parentEdge(nodes, id);
    let out = nodes.map((n) => {
      if (n.id === id) return { ...n, next: b.next };
      if (n.id === b.id) return { ...n, next: id };
      return n;
    });
    if (pe?.parentId) {
      out = setEdge(out, pe.parentId, pe.slot, b.id);
    }
    return out;
  }

  // dir === -1: swap `node` with its predecessor `a` (a.next === id).
  const pe = parentEdge(nodes, id);
  if (!pe?.parentId) {
    return nodes; // node is the root
  }
  const a = map.get(pe.parentId);
  if (!a || a.kind !== "action" || a.next !== id) {
    return nodes; // predecessor is a condition/fork — don't cross it
  }
  const grand = parentEdge(nodes, a.id);
  let out = nodes.map((n) => {
    if (n.id === a.id) return { ...n, next: node.next };
    if (n.id === id) return { ...n, next: a.id };
    return n;
  });
  if (grand?.parentId) {
    out = setEdge(out, grand.parentId, grand.slot, id);
  }
  return out;
}

/**
 * Build a LINEAR chain from a flat node list (Build-with-AI / Refine / recommended
 * template output). Actions chain via `next`; conditions take the `true` edge and
 * leave `false` empty — i.e. a single trunk the user can then fork.
 */
export function linearChain(
  items: { kind: "action" | "condition"; type: string; config?: Record<string, unknown> }[],
): GraphNode[] {
  const nodes = items.map((it) => createNode(it.kind, it.type, it.config ?? {}));
  for (let i = 0; i < nodes.length; i += 1) {
    const nextId = nodes[i + 1]?.id ?? null;
    if (nodes[i].kind === "condition") {
      nodes[i].true = nextId;
    } else {
      nodes[i].next = nextId;
    }
  }
  return nodes;
}

/** Human labels for a condition's two branches (false shown left, true right). */
export function branchLabels(type: string): { true: string; false: string } {
  switch (type) {
    case "invite_accepted":
      return { true: "Accepted", false: "Not accepted" };
    case "is_first_level":
      return { true: "Connected", false: "Not connected" };
    case "message_replied":
      return { true: "Replied", false: "No reply" };
    case "message_opened":
      return { true: "Opened", false: "Not opened" };
    case "has_linkedin_url":
      return { true: "Has URL", false: "No URL" };
    case "is_open_profile":
      return { true: "Open profile", false: "Not open" };
    case "check_data_in_column":
      return { true: "Matches", false: "No match" };
    default:
      return { true: "Yes", false: "No" };
  }
}

/** Prepare nodes for PUT: prune orphans + sync delayDays on wait nodes. */
export function toSavePayload(nodes: GraphNode[]): GraphNode[] {
  return pruneUnreachable(nodes).map((n) => ({
    ...n,
    delayDays: n.type === "wait_x_days" ? Number(n.config.days) || 1 : null,
  }));
}
