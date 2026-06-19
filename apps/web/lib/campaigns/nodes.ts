// Catalog of sequence node types for the builder (mirrors CLAUDE.md §7 + the
// engine's node taxonomy). Drives the +Add action / +Add condition menus and the
// per-node config form.

export type NodeKind = "action" | "condition";

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
  help?: string;
}

export interface NodeDef {
  type: string;
  kind: NodeKind;
  label: string;
  description: string;
  fields: ConfigField[];
}

// Optional AI instruction shared by message-like nodes. When filled, the engine
// generates a personalized line per lead (Gemini) instead of the static template.
const AI_PROMPT_FIELD: ConfigField = {
  key: "aiPrompt",
  label: "AI personalization (optional)",
  type: "textarea",
  placeholder: "e.g. Write a one-line observation about their recent work, then a soft question.",
  help: "If set, AI writes a unique message per lead from their profile. Leave empty to use the template above.",
};

export const ACTION_NODES: NodeDef[] = [
  {
    type: "send_connection_request",
    kind: "action",
    label: "Connection request",
    description: "Send a connection request (no note by default — it performs best).",
    fields: [
      {
        key: "note",
        label: "Note (optional)",
        type: "textarea",
        placeholder: "Leave empty for the best acceptance rate",
        help: "Default is no note. Supports {first_name}, {company}.",
      },
    ],
  },
  {
    type: "send_message",
    kind: "action",
    label: "Message",
    description: "Send a direct message (1st-degree connections).",
    fields: [
      {
        key: "body",
        label: "Message",
        type: "textarea",
        placeholder: "Hi {first_name}, …",
        help: "Supports {first_name}, {company}, {role}.",
      },
      AI_PROMPT_FIELD,
    ],
  },
  {
    type: "send_voice_note",
    kind: "action",
    label: "Voice note",
    description: "Send a native LinkedIn voice note (recorded/uploaded).",
    fields: [
      { key: "audioRef", label: "Audio reference", type: "text", placeholder: "voice profile / file ref" },
    ],
  },
  {
    type: "comment_last_post",
    kind: "action",
    label: "Comment on last post",
    description: "Leave an AI-style comment on the lead's most recent post.",
    fields: [
      { key: "text", label: "Comment", type: "textarea", placeholder: "Great point about {company}…" },
      AI_PROMPT_FIELD,
    ],
  },
  { type: "like_last_post", kind: "action", label: "Like last post", description: "Like the lead's most recent post.", fields: [] },
  { type: "visit_profile", kind: "action", label: "Visit profile", description: "View the lead's profile (warms up the relationship).", fields: [] },
  {
    type: "inmail",
    kind: "action",
    label: "InMail",
    description: "Send an InMail (premium / open profiles).",
    fields: [
      { key: "subject", label: "Subject", type: "text", placeholder: "Quick question" },
      { key: "body", label: "Body", type: "textarea", placeholder: "Hi {first_name}, …" },
    ],
  },
  {
    type: "send_message_to_open_profile",
    kind: "action",
    label: "Open-profile message",
    description: "Message a lead with an Open Profile, no connection needed.",
    fields: [{ key: "body", label: "Message", type: "textarea", placeholder: "Hi {first_name}, …" }],
  },
  { type: "follow_lead", kind: "action", label: "Follow", description: "Follow the lead.", fields: [] },
  {
    type: "add_tag",
    kind: "action",
    label: "Add tag",
    description: "Tag the lead (no LinkedIn action).",
    fields: [{ key: "tag", label: "Tag", type: "text", placeholder: "interested" }],
  },
  {
    type: "wait_x_days",
    kind: "action",
    label: "Wait",
    description: "Pause before the next step.",
    fields: [{ key: "days", label: "Days", type: "number", placeholder: "3" }],
  },
];

export const CONDITION_NODES: NodeDef[] = [
  { type: "invite_accepted", kind: "condition", label: "Invite accepted?", description: "Continue once the connection is accepted (waits up to 7 days).", fields: [] },
  { type: "message_replied", kind: "condition", label: "Replied?", description: "Branch on whether the lead has replied.", fields: [] },
  { type: "message_opened", kind: "condition", label: "Message opened?", description: "Branch on whether the lead opened your message.", fields: [] },
  { type: "has_linkedin_url", kind: "condition", label: "Has LinkedIn URL?", description: "Branch on whether the lead has a LinkedIn profile.", fields: [] },
  { type: "is_first_level", kind: "condition", label: "Is 1st-degree?", description: "Branch on connection degree.", fields: [] },
  { type: "is_open_profile", kind: "condition", label: "Is Open Profile?", description: "Branch on whether the lead is an Open Profile.", fields: [] },
  {
    type: "check_data_in_column",
    kind: "condition",
    label: "Check column",
    description: "Branch on a custom column value.",
    fields: [
      { key: "column", label: "Column", type: "text", placeholder: "industry" },
      { key: "equals", label: "Equals (optional)", type: "text", placeholder: "SaaS" },
    ],
  },
];

const ALL_NODES = [...ACTION_NODES, ...CONDITION_NODES];

export function nodeDef(type: string): NodeDef | undefined {
  return ALL_NODES.find((n) => n.type === type);
}

export function nodeLabel(type: string): string {
  return nodeDef(type)?.label ?? type;
}
