// Web-side helpers for the message composer. The structured body, variable
// registry, and renderer are shared from @10xconnect/core so the Preview renders
// exactly what the engine dispatches (CLAUDE.md §7).

import {
  type ComposerAttachment,
  DEFAULT_SEND_CONDITION,
  extractAiPrompt,
  type MessageBody,
  messageBodyToTemplate,
  readMessageBody,
  type SendCondition,
} from "@10xconnect/core";

/** Node types that open the composer panel (CLAUDE.md §7 text-bearing nodes). */
export const COMPOSER_TYPES = new Set([
  "send_message",
  "send_voice_note",
  "inmail",
  "send_message_to_open_profile",
  "comment_last_post",
  "reply_comment",
  // The connection-request "note" is edited in the composer too (sidebar, with
  // merge variables) rather than an inline card textarea. Its body is OPTIONAL —
  // no note = best acceptance rate (§2 default). See bodyOptional().
  "send_connection_request",
]);

export function isComposerType(type: string): boolean {
  return COMPOSER_TYPES.has(type);
}

/** Composer types with a merge-field text body (voice notes carry audio, not text). */
export function hasTextBody(type: string): boolean {
  return isComposerType(type) && type !== "send_voice_note";
}

/**
 * Composer types whose text body is OPTIONAL — empty is valid and must not raise
 * the "Action required" badge. Today only the connection-request note (§2: the
 * no-note default performs best).
 */
export function bodyOptional(type: string): boolean {
  return type === "send_connection_request";
}

/** Legacy string config keys for a node's text, in priority order. */
export function legacyTextKeys(type: string): string[] {
  if (type === "comment_last_post" || type === "reply_comment") {
    return ["text", "comment", "body"];
  }
  // The engine dispatches a connection request from config.note (see executor).
  if (type === "send_connection_request") {
    return ["note", "body"];
  }
  return ["body", "message"];
}

/** Config keys the composer manages (body/AI/etc.) — NOT shown as inline card fields. */
export const COMPOSER_MANAGED_KEYS = new Set([
  "body",
  "text",
  "message",
  "comment",
  "note", // connection-request note — edited in the composer, not inline
  "aiPrompt",
  "subject",
  "messageBody",
  "audioRef",
  "senders",
  "attachments",
  "sendCondition",
]);

/** Types the user can switch a composer node to via the "Change" control. */
export const CHANGEABLE_TYPES = [
  "send_message",
  "inmail",
  "send_message_to_open_profile",
  "comment_last_post",
  "reply_comment",
  "send_voice_note",
] as const;

// Default AI-variation prompt so comment replies never look copy-pasted (§2/E2).
const REPLY_VARIATION_PROMPT =
  "Reply briefly and warmly to their comment. Vary the wording naturally across leads " +
  "(e.g. \"here it is\", \"there you go\", \"sent it over\") — never identical, never salesy.";

/** Seed config for a freshly-added node (e.g. reply_comment's AI-variation body). */
export function defaultConfigFor(type: string): Record<string, unknown> {
  if (type === "reply_comment") {
    const body: MessageBody = { v: 1, segments: [{ type: "ai", prompt: REPLY_VARIATION_PROMPT }] };
    return { ...bodyConfigPatch(type, body), postUrl: "" };
  }
  return {};
}

function isSendCondition(value: unknown): value is SendCondition {
  return (
    !!value &&
    typeof value === "object" &&
    ((value as SendCondition).type === "always" ||
      (value as SendCondition).type === "never_messaged")
  );
}

export interface ComposerState {
  body: MessageBody;
  senders: string[];
  attachments: ComposerAttachment[];
  sendCondition: SendCondition;
  subject: string;
  audioRef: string;
}

/** Derive the composer's editable state from raw node config. */
export function readComposer(type: string, config: Record<string, unknown>): ComposerState {
  return {
    body: readMessageBody(config, legacyTextKeys(type)),
    senders: Array.isArray(config.senders)
      ? config.senders.filter((s): s is string => typeof s === "string")
      : [],
    attachments: Array.isArray(config.attachments)
      ? (config.attachments as ComposerAttachment[])
      : [],
    sendCondition: isSendCondition(config.sendCondition)
      ? config.sendCondition
      : DEFAULT_SEND_CONDITION,
    subject: typeof config.subject === "string" ? config.subject : "",
    audioRef: typeof config.audioRef === "string" ? config.audioRef : "",
  };
}

/** Config patch for a body edit: canonical messageBody + derived legacy text + aiPrompt. */
export function bodyConfigPatch(type: string, body: MessageBody): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    messageBody: body,
    aiPrompt: extractAiPrompt(body),
  };
  // Keep the engine's legacy string key in sync: comment reads `text`, a
  // connection request dispatches from `note`, everything else uses `body`.
  const legacyKey =
    type === "comment_last_post" ? "text" : type === "send_connection_request" ? "note" : "body";
  patch[legacyKey] = messageBodyToTemplate(body);
  return patch;
}

/**
 * Prune config when switching a node's action type via "Change": keep shared
 * composer keys (body, senders, attachments, sendCondition); drop keys that no
 * longer apply to the new type.
 */
export function configForTypeChange(
  fromConfig: Record<string, unknown>,
  toType: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...fromConfig };
  if (toType !== "inmail") {
    delete next.subject;
  }
  if (toType !== "send_voice_note") {
    delete next.audioRef;
  }
  if (!hasTextBody(toType)) {
    // Moving to voice note: text body no longer applies.
    delete next.messageBody;
    delete next.body;
    delete next.text;
    delete next.aiPrompt;
  }
  return next;
}
