// Shared message renderer (CLAUDE.md §2 — no broken merges; §7 composer). Both the
// web preview and the engine dispatch call renderMessageBody() so "what you preview
// is what sends" — the only divergence is renderAi (web stub vs engine AI resolver).
//
// Safety contract: a variable that resolves empty AND has no fallback is DROPPED,
// then surrounding whitespace/punctuation is collapsed, so a message never renders
// broken (never "Hi ," or "saw you're doing ").

import type { MessageBody, MessageSegment } from "./segments";

export interface RenderOptions {
  /** Resolve an AI segment to text. Engine: personalization; web preview: a stub. */
  renderAi?: (seg: { promptId?: string; prompt?: string }) => string;
}

/** Collapse whitespace left behind by dropped segments. Preserves newlines. */
function collapseWhitespace(value: string): string {
  return value
    .replace(/[ \t]+([,.!?;:])/g, "$1") // space(s) before punctuation
    .replace(/[ \t]{2,}/g, " ") // runs of horizontal whitespace
    .replace(/[ \t]+\n/g, "\n") // trailing space before newline
    .replace(/\n[ \t]+/g, "\n") // leading space after newline
    .replace(/\n{3,}/g, "\n\n") // cap runaway blank lines (keep paragraph breaks)
    .trim();
}

/** Render a structured body to a final string for one lead's resolved variables. */
export function renderMessageBody(
  body: MessageBody,
  vars: Record<string, string>,
  opts: RenderOptions = {},
): string {
  const parts: string[] = [];
  for (const seg of body.segments ?? []) {
    if (seg.type === "text") {
      parts.push(seg.text);
    } else if (seg.type === "variable") {
      const resolved = (vars[seg.key] ?? "").trim();
      if (resolved) {
        parts.push(resolved);
      } else if (seg.fallback && seg.fallback.trim()) {
        parts.push(seg.fallback.trim());
      }
      // else: skip-on-empty (the no-broken-merge guarantee)
    } else if (seg.type === "ai") {
      const resolved = opts.renderAi ? opts.renderAi(seg) : "";
      if (resolved && resolved.trim()) {
        parts.push(resolved.trim());
      }
    }
  }
  return collapseWhitespace(parts.join(""));
}

/** Serialize a structured body back to a legacy `{token}` template string. */
export function messageBodyToTemplate(body: MessageBody): string {
  return (body.segments ?? [])
    .map((s) => (s.type === "text" ? s.text : s.type === "variable" ? `{${s.key}}` : ""))
    .join("");
}

/** The first AI segment's prompt, if any (mirrored to legacy config.aiPrompt). */
export function extractAiPrompt(body: MessageBody): string | undefined {
  const ai = body.segments?.find(
    (s): s is Extract<MessageSegment, { type: "ai" }> => s.type === "ai",
  );
  return ai?.prompt?.trim() || undefined;
}

const TOKEN_RE = /\{([a-zA-Z0-9_.]+)\}/g;

/** Parse a legacy `{token}` template (+ optional aiPrompt) into a structured body. */
export function legacyToMessageBody(body?: string, aiPrompt?: string): MessageBody {
  const segments: MessageSegment[] = [];
  const text = typeof body === "string" ? body : "";
  let last = 0;
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    if (m.index > last) {
      segments.push({ type: "text", text: text.slice(last, m.index) });
    }
    segments.push({ type: "variable", key: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ type: "text", text: text.slice(last) });
  }
  TOKEN_RE.lastIndex = 0;
  if (aiPrompt && aiPrompt.trim()) {
    segments.push({ type: "ai", prompt: aiPrompt.trim() });
  }
  return { v: 1, segments };
}

function isMessageBody(value: unknown): value is MessageBody {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { segments?: unknown }).segments)
  );
}

/**
 * Read the canonical structured body from node config: prefer `messageBody`, else
 * synthesize from the legacy string keys (+ aiPrompt). Used by web load + engine.
 */
export function readMessageBody(
  config: Record<string, unknown>,
  legacyKeys: string[] = ["body", "message"],
): MessageBody {
  if (isMessageBody(config.messageBody)) {
    return config.messageBody;
  }
  const legacy = legacyKeys
    .map((k) => config[k])
    .find((v): v is string => typeof v === "string" && v.length > 0);
  const aiPrompt = typeof config.aiPrompt === "string" ? config.aiPrompt : undefined;
  return legacyToMessageBody(legacy, aiPrompt);
}

/** True if the body has any meaningful content (drives the "Action required" badge). */
export function isBodyConfigured(body: MessageBody | undefined): boolean {
  if (!body || !Array.isArray(body.segments)) {
    return false;
  }
  return body.segments.some(
    (s) =>
      (s.type === "text" && s.text.trim().length > 0) ||
      s.type === "variable" ||
      (s.type === "ai" && ((s.prompt?.trim().length ?? 0) > 0 || !!s.promptId)),
  );
}
