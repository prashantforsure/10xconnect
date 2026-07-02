// Sequence-graph validator (CLAUDE.md §7). The builder's client model
// (apps/web/lib/campaigns/graph.ts) maintains these invariants by construction;
// this is the SERVER-SIDE enforcement so no client (builder, AI generator,
// public API) can persist a graph the dispatch engine cannot execute safely:
// a cycle loops a lead forever, a dangling ref silently completes it, and an
// unknown node type is skipped as "unsupported" at dispatch time.
//
// Errors block the save; warnings are advisory (legitimate-but-suspect shapes
// the builder allows, e.g. a condition whose branches both end).

import { ALLOWED_ACTION_TYPES, ALLOWED_CONDITION_TYPES } from "../campaign-gen";

/** The shape saveSequence receives — client ids, pre-remap. */
export interface SequenceGraphNode {
  id: string;
  kind: "action" | "condition";
  type: string;
  next?: string | null;
  true?: string | null;
  false?: string | null;
}

export type GraphIssueCode =
  | "duplicate_id"
  | "unknown_type"
  | "email_not_supported"
  | "dangling_ref"
  | "multiple_roots"
  | "cycle"
  | "condition_dead_end"
  | "action_with_branches";

export interface GraphIssue {
  code: GraphIssueCode;
  /** Offending node id (client id), when the issue is node-specific. */
  nodeId?: string;
  message: string;
}

export interface GraphValidation {
  /** True when there are no errors (warnings allowed). */
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
}

// Email transport ships in Phase 11; until then these node types would be
// silently skipped by dispatch — reject them so users aren't misled (§2).
const EMAIL_NODE_TYPES = new Set(["send_email", "email_followup", "email_opened", "email_clicked", "email_bounced"]);

const edgeTargets = (n: SequenceGraphNode): string[] =>
  [n.next, n.true, n.false].filter((id): id is string => typeof id === "string" && id.length > 0);

/**
 * Validate a full sequence graph before persisting it. An empty graph is valid
 * (a draft can be empty; starting an empty campaign is blocked separately).
 */
export function validateSequenceGraph(nodes: SequenceGraphNode[]): GraphValidation {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];

  if (nodes.length === 0) {
    return { ok: true, errors, warnings };
  }

  // -- ids ------------------------------------------------------------------
  const byId = new Map<string, SequenceGraphNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      errors.push({ code: "duplicate_id", nodeId: node.id, message: `Duplicate node id "${node.id}".` });
    } else {
      byId.set(node.id, node);
    }
  }

  // -- node types -----------------------------------------------------------
  for (const node of nodes) {
    if (EMAIL_NODE_TYPES.has(node.type)) {
      errors.push({
        code: "email_not_supported",
        nodeId: node.id,
        message: `Email steps aren't supported yet — remove the "${node.type}" step. (Email ships in a later release.)`,
      });
      continue;
    }
    const allowed = node.kind === "condition" ? ALLOWED_CONDITION_TYPES : ALLOWED_ACTION_TYPES;
    if (!allowed.has(node.type)) {
      errors.push({
        code: "unknown_type",
        nodeId: node.id,
        message: `Unknown ${node.kind} type "${node.type}".`,
      });
    }
  }

  // -- edges resolve --------------------------------------------------------
  for (const node of nodes) {
    for (const target of edgeTargets(node)) {
      if (!byId.has(target)) {
        errors.push({
          code: "dangling_ref",
          nodeId: node.id,
          message: `Node "${node.id}" points at a step that doesn't exist ("${target}").`,
        });
      }
    }
    if (node.kind === "action" && (node.true || node.false)) {
      warnings.push({
        code: "action_with_branches",
        nodeId: node.id,
        message: `Action node "${node.id}" carries condition branches; they will be ignored.`,
      });
    }
    if (node.kind === "condition" && !node.true && !node.false) {
      warnings.push({
        code: "condition_dead_end",
        nodeId: node.id,
        message: `Condition "${node.type}" has no branch after it — leads finish the sequence there.`,
      });
    }
  }

  // -- single root ----------------------------------------------------------
  // Root = a node no edge targets (mirrors the engine's loadGraph). Zero roots
  // means every node is inside a cycle; multiple roots means disconnected
  // chains, and which one runs would be non-deterministic.
  const targeted = new Set<string>();
  for (const node of nodes) {
    for (const target of edgeTargets(node)) {
      targeted.add(target);
    }
  }
  const roots = nodes.filter((n) => !targeted.has(n.id));
  if (roots.length === 0) {
    errors.push({ code: "cycle", message: "The sequence loops back on itself — it has no starting step." });
  } else if (roots.length > 1) {
    errors.push({
      code: "multiple_roots",
      message: `The sequence has ${roots.length} disconnected starting steps — connect them into one flow.`,
    });
  }

  // -- cycles (iterative colored DFS over next/true/false) -------------------
  // Only meaningful once ids are unique and refs resolve; skip if already broken.
  if (!errors.some((e) => e.code === "duplicate_id" || e.code === "dangling_ref")) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
    for (const start of nodes) {
      if (color.get(start.id) !== WHITE) {
        continue;
      }
      // Stack frames: [nodeId, nextEdgeIndex]
      const stack: Array<[string, number]> = [[start.id, 0]];
      color.set(start.id, GRAY);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const node = byId.get(frame[0]) as SequenceGraphNode;
        const targets = edgeTargets(node);
        if (frame[1] >= targets.length) {
          color.set(node.id, BLACK);
          stack.pop();
          continue;
        }
        const target = targets[frame[1]];
        frame[1] += 1;
        const c = color.get(target);
        if (c === GRAY) {
          errors.push({
            code: "cycle",
            nodeId: target,
            message: "The sequence contains a loop — a lead would repeat the same steps forever.",
          });
          // One cycle error is enough; bail out of detection entirely.
          return { ok: false, errors, warnings };
        }
        if (c === WHITE) {
          color.set(target, GRAY);
          stack.push([target, 0]);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
