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
]);

export function isComposerType(type: string): boolean {
  return COMPOSER_TYPES.has(type);
}

/** Composer types with a merge-field text body (voice notes carry audio, not text). */
export function hasTextBody(type: string): boolean {
  return isComposerType(type) && type !== "send_voice_note";
}

/** Legacy string config keys for a node's text, in priority order. */
export function legacyTextKeys(type: string): string[] {
  return type === "comment_last_post" ? ["text", "comment", "body"] : ["body", "message"];
}

/** Types the user can switch a composer node to via the "Change" control. */
export const CHANGEABLE_TYPES = [
  "send_message",
  "inmail",
  "send_message_to_open_profile",
  "comment_last_post",
  "send_voice_note",
] as const;

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
  patch[type === "comment_last_post" ? "text" : "body"] = messageBodyToTemplate(body);
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
