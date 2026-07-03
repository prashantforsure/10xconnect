// Sequence-TIMING guardrails (§7 methodology, E3 = advisory, never blocks).
// The message linter covers copy; this covers pacing — the other half of "don't
// look like a bot". Pure and structural: the builder passes its GraphNode[] in
// directly (SequenceLintNode is a structural subset), no web imports here.

import type { LintFinding } from "./guardrails";

/** Structural subset of the builder's GraphNode — pass builder nodes straight in. */
export interface SequenceLintNode {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
  next: string | null;
  true: string | null;
  false: string | null;
  delayDays: number | null;
}

export interface SequenceLintFinding extends LintFinding {
  /** The node the advisory points at (the send that fires too soon). */
  nodeId?: string;
}

/** Node types that land a message in the lead's inbox. */
const MESSAGE_SENDS = new Set([
  "send_message",
  "inmail",
  "send_message_to_open_profile",
  "send_voice_note",
]);

const MIN_WAIT_AFTER_CONNECTION_DAYS = 7;
const MIN_WAIT_BETWEEN_MESSAGES_DAYS = 2;

function waitDays(node: SequenceLintNode): number {
  if (node.type !== "wait_x_days") return 0;
  const days = Number(node.config.days ?? node.delayDays ?? 0);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function edgeDelay(node: SequenceLintNode): number {
  // wait_x_days nodes mirror their wait into delayDays — already counted by
  // waitDays(), so don't count it again on the outgoing edge.
  if (node.type === "wait_x_days") return 0;
  const d = Number(node.delayDays ?? 0);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

interface WalkState {
  /** Days since the last send_connection_request, null once gated/none seen. */
  sinceConnection: number | null;
  /** Days since the last message-type send, null if none yet. */
  sinceMessage: number | null;
}

/**
 * Advisory timing lint over the whole sequence graph. Walks every branch
 * (next + condition true/false), tracking cumulative wait since the last
 * connection request and since the last message send. Findings are deduped
 * per (rule, node) — a node reachable down two branches warns once.
 */
export function lintSequenceTiming(nodes: SequenceLintNode[]): SequenceLintFinding[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = findRoots(nodes);
  const findings = new Map<string, SequenceLintFinding>();
  // Guard cycles/re-walks: a node can be re-visited with a DIFFERENT elapsed
  // state down another branch, so key visits by node + rounded state.
  const visited = new Set<string>();

  const walk = (id: string | null, state: WalkState): void => {
    if (!id) return;
    const node = byId.get(id);
    if (!node) return;
    const visitKey = `${id}|${state.sinceConnection ?? "-"}|${state.sinceMessage ?? "-"}`;
    if (visited.has(visitKey) || visited.size > 5000) return;
    visited.add(visitKey);

    const next: WalkState = { ...state };

    if (node.type === "wait_x_days") {
      const days = waitDays(node);
      if (next.sinceConnection !== null) next.sinceConnection += days;
      if (next.sinceMessage !== null) next.sinceMessage += days;
    } else if (node.type === "send_connection_request") {
      next.sinceConnection = 0;
    } else if (node.type === "invite_accepted") {
      // Once the sequence checks for acceptance, follow-ups on the accepted
      // branch aren't "too soon after the request" — clear the clock there.
      const accepted: WalkState = { ...next, sinceConnection: null };
      advance(node, "true", accepted);
      advance(node, "false", next);
      return;
    } else if (MESSAGE_SENDS.has(node.type)) {
      if (node.type !== "inmail" && next.sinceConnection !== null && next.sinceConnection < MIN_WAIT_AFTER_CONNECTION_DAYS) {
        const key = `short_wait_after_connection:${node.id}`;
        findings.set(key, {
          id: "short_wait_after_connection",
          severity: "warn",
          nodeId: node.id,
          message: `Follow-up ${describeDays(next.sinceConnection)} after the connection request — 7–12 days converts better, or gate it behind an "invite accepted" check.`,
        });
      }
      if (next.sinceMessage !== null && next.sinceMessage < MIN_WAIT_BETWEEN_MESSAGES_DAYS) {
        const key = `messages_too_close:${node.id}`;
        findings.set(key, {
          id: "messages_too_close",
          severity: "warn",
          nodeId: node.id,
          message: `Back-to-back messages ${describeDays(next.sinceMessage)} apart read as pushy — space follow-ups 3+ days.`,
        });
      }
      next.sinceMessage = 0;
      next.sinceConnection = null;
    }

    if (node.kind === "condition") {
      advance(node, "true", next);
      advance(node, "false", next);
    } else {
      advance(node, "next", next);
    }
  };

  const advance = (node: SequenceLintNode, edge: "next" | "true" | "false", state: WalkState): void => {
    const target = node[edge];
    const delay = edgeDelay(node);
    if (!delay) {
      walk(target, state);
      return;
    }
    walk(target, {
      sinceConnection: state.sinceConnection === null ? null : state.sinceConnection + delay,
      sinceMessage: state.sinceMessage === null ? null : state.sinceMessage + delay,
    });
  };

  for (const root of roots) {
    walk(root.id, { sinceConnection: null, sinceMessage: null });
  }
  return [...findings.values()];
}

function describeDays(days: number): string {
  if (days <= 0) return "immediately";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function findRoots(nodes: SequenceLintNode[]): SequenceLintNode[] {
  const referenced = new Set<string>();
  for (const n of nodes) {
    if (n.next) referenced.add(n.next);
    if (n.true) referenced.add(n.true);
    if (n.false) referenced.add(n.false);
  }
  const roots = nodes.filter((n) => !referenced.has(n.id));
  // A fully-cyclic graph has no root — fall back to the first node so the
  // linter still sees something rather than silently passing.
  return roots.length ? roots : nodes.slice(0, 1);
}
