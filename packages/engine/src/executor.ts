// Maps a sequence node to its ChannelAdapter verb and runs it. The adapter is an
// interface (mock for dev, Unipile live) — no provider SDKs here. Connection
// requests default to NO note (CLAUDE.md §2). Text is resolved per-lead (variable
// injection by default; AI personalization when deps.resolveContent is wired).

import type { AccountRef, ActionResult, ChannelAdapter, LeadRef, SendOptions } from "@10xconnect/core";
import { messageBodyToTemplate, readMessageBody, renderMessageBody } from "@10xconnect/core";

import type { ContentResolver, LeadRow } from "./types";
import { injectVariables, leadVariables } from "./variables";

export interface ExecuteInput {
  adapter: ChannelAdapter;
  accountRef: AccountRef;
  leadRef: LeadRef;
  workspaceId: string;
  nodeType: string;
  config: Record<string, unknown>;
  idempotencyKey: string;
  lead: LeadRow;
  resolveContent?: ContentResolver;
}

function failure(idempotencyKey: string, message: string): ActionResult {
  return {
    status: "failed",
    idempotencyKey,
    error: { code: "invalid_request", message, retriable: false },
  };
}

async function text(input: ExecuteInput, keys: string[]): Promise<string> {
  // Read the structured composer body (falls back to legacy {token} templates).
  const body = readMessageBody(input.config, keys);
  // Whole-message AI: when a body carries an AI segment, defer to the resolver so
  // it generates per-lead (the M6 personalization contract). Otherwise render the
  // structured body ourselves with variable fallback + skip-on-empty (no broken
  // merges — CLAUDE.md §2), which is also what the web Preview renders.
  const hasAi = body.segments.some((s) => s.type === "ai");
  if (hasAi && input.resolveContent) {
    return input.resolveContent({
      workspaceId: input.workspaceId,
      nodeType: input.nodeType,
      template: messageBodyToTemplate(body),
      config: input.config,
      lead: input.lead,
    });
  }
  return renderMessageBody(body, leadVariables(input.lead));
}

/** Execute a transport node via the adapter; returns the typed ActionResult. */
export async function executeTransportAction(input: ExecuteInput): Promise<ActionResult> {
  const { adapter, accountRef, leadRef, config } = input;
  const opts: SendOptions = { idempotencyKey: input.idempotencyKey };

  switch (input.nodeType) {
    case "send_connection_request": {
      // No-note default (§2): only attach a note if one is explicitly configured.
      const note = typeof config.note === "string" && config.note.trim() ? config.note : undefined;
      return adapter.sendConnectionRequest(accountRef, leadRef, {
        ...opts,
        ...(note ? { note: injectVariables(note, input.lead) } : {}),
      });
    }
    case "send_message":
      return adapter.sendMessage(accountRef, leadRef, { body: await text(input, ["body", "message"]) }, opts);
    case "send_message_to_open_profile":
      return adapter.sendOpenProfileMessage(
        accountRef,
        leadRef,
        { body: await text(input, ["body", "message"]) },
        opts,
      );
    case "send_voice_note":
      return adapter.sendVoiceNote(
        accountRef,
        leadRef,
        {
          audioRef: typeof config.audioRef === "string" ? config.audioRef : "",
          ...(typeof config.durationMs === "number" ? { durationMs: config.durationMs } : {}),
        },
        opts,
      );
    case "inmail":
      return adapter.sendInMail(
        accountRef,
        leadRef,
        {
          ...(typeof config.subject === "string" ? { subject: config.subject } : {}),
          body: await text(input, ["body", "message"]),
        },
        opts,
      );
    case "comment_last_post":
      return adapter.commentPost(accountRef, leadRef, await text(input, ["text", "comment", "body"]), opts);
    case "reply_comment":
      return adapter.replyComment(accountRef, leadRef, await text(input, ["text", "comment", "body"]), opts);
    case "like_last_post":
      return adapter.likePost(accountRef, leadRef, opts);
    case "visit_profile":
      return adapter.visitProfile(accountRef, leadRef, opts);
    case "follow_lead":
      return adapter.followLead(accountRef, leadRef, opts);
    case "send_email":
    case "email_followup":
      return failure(input.idempotencyKey, "Email channel is out of scope for this MVP (LinkedIn parity first).");
    default:
      return failure(input.idempotencyKey, `Unsupported action node: ${input.nodeType}`);
  }
}
