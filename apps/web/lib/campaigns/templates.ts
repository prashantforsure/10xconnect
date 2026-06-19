// Builder templates → pre-wired GraphNode chains for one-click insertion. Each
// returns the chain plus its entry node and the "main tail" node whose `next`
// should adopt any existing downstream steps (CLAUDE.md §7 follow-up discipline +
// the connected-vs-not branching template).

import { createNode, type GraphNode } from "./graph";

export type TemplateKind = "nurture" | "revisit" | "connected_split";

export interface BuiltTemplate {
  chain: GraphNode[];
  entryId: string;
  tailNodeId: string;
}

/** Engagement nurture: like → wait → visit → wait → comment (CLAUDE.md §7). */
function nurture(): BuiltTemplate {
  const like = createNode("action", "like_last_post");
  const w1 = createNode("action", "wait_x_days", { days: 2 });
  const visit = createNode("action", "visit_profile");
  const w2 = createNode("action", "wait_x_days", { days: 2 });
  const comment = createNode("action", "comment_last_post");
  like.next = w1.id;
  w1.next = visit.id;
  visit.next = w2.id;
  w2.next = comment.id;
  return { chain: [like, w1, visit, w2, comment], entryId: like.id, tailNodeId: comment.id };
}

/** Revisit later: long wait, then a fresh-angle message. */
function revisit(): BuiltTemplate {
  const wait = createNode("action", "wait_x_days", { days: 60 });
  const msg = createNode("action", "send_message", {
    body: "Hi {first_name}, circling back with a fresh angle — worth a quick chat about {company}?",
  });
  wait.next = msg.id;
  return { chain: [wait, msg], entryId: wait.id, tailNodeId: msg.id };
}

/**
 * Connected vs not connected (Part B #5): branch on 1st-degree connection.
 *   connected  → send a message
 *   not        → connection request → invite_accepted? → message
 * The connected path is the "main tail" so existing downstream steps continue there.
 */
function connectedSplit(): BuiltTemplate {
  const cond = createNode("condition", "is_first_level");
  const connectedMsg = createNode("action", "send_message", {
    body: "Hi {first_name}, great to be connected! What are you focused on at {company} this quarter?",
  });
  const connReq = createNode("action", "send_connection_request");
  const accepted = createNode("condition", "invite_accepted");
  const acceptedMsg = createNode("action", "send_message", {
    body: "Hi {first_name}, thanks for connecting! What are you working on at {company} right now?",
  });

  cond.true = connectedMsg.id; // connected → message
  cond.false = connReq.id; // not connected → connect first
  connReq.next = accepted.id;
  accepted.true = acceptedMsg.id; // accepted → message; declined/no-response ends

  return {
    chain: [cond, connectedMsg, connReq, accepted, acceptedMsg],
    entryId: cond.id,
    tailNodeId: connectedMsg.id,
  };
}

export function buildTemplate(kind: TemplateKind): BuiltTemplate {
  switch (kind) {
    case "nurture":
      return nurture();
    case "revisit":
      return revisit();
    case "connected_split":
      return connectedSplit();
  }
}
