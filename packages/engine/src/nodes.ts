// Sequence node taxonomy (CLAUDE.md §7) and the mapping from a node type to a
// transport ActionType. Action nodes either map to a ChannelAdapter verb, are
// orchestration-only (add_tag, wait_x_days), or are conditions (branch). Pure.

import type { ActionType } from "@10xconnect/core";

/** The 12 LinkedIn action nodes + email (email is out of MVP scope but modeled). */
export type ActionNodeType =
  | "send_connection_request"
  | "send_message"
  | "send_voice_note"
  | "comment_last_post"
  | "like_last_post"
  | "visit_profile"
  | "inmail"
  | "add_tag"
  | "reply_comment"
  | "send_message_to_open_profile"
  | "follow_lead"
  | "wait_x_days"
  | "send_email"
  | "email_followup";

/** Condition (branching) nodes. */
export type ConditionNodeType =
  | "has_linkedin_url"
  | "is_first_level"
  | "message_opened"
  | "is_open_profile"
  | "check_data_in_column"
  | "invite_accepted"
  | "message_replied"
  | "email_opened"
  | "email_clicked"
  | "email_bounced";

export type NodeType = ActionNodeType | ConditionNodeType;

/** Node types that map to a transport ActionType (a real ChannelAdapter send). */
const NODE_TO_ACTION: Partial<Record<ActionNodeType, ActionType>> = {
  send_connection_request: "connection_request",
  send_message: "message",
  send_voice_note: "voice_note",
  comment_last_post: "comment_post",
  like_last_post: "like_post",
  visit_profile: "visit_profile",
  inmail: "inmail",
  reply_comment: "reply_comment",
  send_message_to_open_profile: "open_profile_message",
  follow_lead: "follow_lead",
  send_email: "email",
  email_followup: "email",
};

/** The transport ActionType for a node, or null for orchestration-only nodes. */
export function nodeToActionType(type: string): ActionType | null {
  return NODE_TO_ACTION[type as ActionNodeType] ?? null;
}

/** Orchestration-only action nodes (no transport send). */
export function isOrchestrationNode(type: string): boolean {
  return type === "add_tag" || type === "wait_x_days";
}

export const CONDITION_NODE_TYPES: ReadonlySet<string> = new Set<ConditionNodeType>([
  "has_linkedin_url",
  "is_first_level",
  "message_opened",
  "is_open_profile",
  "check_data_in_column",
  "invite_accepted",
  "message_replied",
  "email_opened",
  "email_clicked",
  "email_bounced",
]);

export function isConditionType(type: string): boolean {
  return CONDITION_NODE_TYPES.has(type);
}

/**
 * Event-based conditions wait for an inbound event (with a timeout) before
 * branching; static conditions evaluate immediately from lead data.
 */
export const EVENT_CONDITION_TYPES: ReadonlySet<string> = new Set([
  "invite_accepted",
  "message_opened",
  "message_replied",
  "email_opened",
  "email_clicked",
  "email_bounced",
]);

export function isEventCondition(type: string): boolean {
  return EVENT_CONDITION_TYPES.has(type);
}

/** Default days to wait for an event condition before taking the false branch. */
export const DEFAULT_CONDITION_WAIT_DAYS: Record<string, number> = {
  invite_accepted: 7,
  message_opened: 3,
  message_replied: 3,
  email_opened: 3,
  email_clicked: 3,
  email_bounced: 1,
};
