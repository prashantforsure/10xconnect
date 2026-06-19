// Structured message body for the campaign composer (CLAUDE.md §7). A message is
// a list of segments — free text interleaved with variable chips (each carrying a
// FALLBACK) and AI-prompt chips. The structured form is what guarantees no broken
// merges: an empty variable with no fallback is SKIPPED rather than rendered as "".
// Pure + DB-free so both the web composer/preview and the engine executor share it.

/** One piece of a composed message. */
export type MessageSegment =
  | { type: "text"; text: string }
  /** A contact variable; renders vars[key], else `fallback`, else is dropped. */
  | { type: "variable"; key: string; fallback?: string }
  /** An AI-personalized segment. `promptId` is reserved for the E2 prompt library. */
  | { type: "ai"; promptId?: string; prompt?: string };

/** Versioned structured message body stored under node config `messageBody`. */
export interface MessageBody {
  v: 1;
  segments: MessageSegment[];
}

export type AttachmentKind = "image" | "video" | "file";

/** A media attachment on a message node (stored in node config `attachments`). */
export interface ComposerAttachment {
  kind: AttachmentKind;
  /** Storage path (source of truth). */
  ref: string;
  /** Optional preview URL (signed/public); not authoritative. */
  url?: string;
  name?: string;
  mime?: string;
  size?: number;
}

/** When a message node should actually send. Extensible by `type`. */
export type SendCondition = { type: "always" } | { type: "never_messaged" };

export const DEFAULT_SEND_CONDITION: SendCondition = { type: "always" };

/** A contact variable the composer can insert. `key` is the engine variable key. */
export interface VariableDef {
  key: string;
  label: string;
  group: "lead" | "company";
}

// The composer's variable palette (CLAUDE.md §7). `label` is what the user sees;
// `key` maps to the engine's leadVariables() (see packages/engine/src/variables.ts).
// Job title→role and Company name→company are label remaps over existing keys.
export const VARIABLE_REGISTRY: VariableDef[] = [
  { key: "first_name", label: "First Name", group: "lead" },
  { key: "last_name", label: "Last Name", group: "lead" },
  { key: "headline", label: "Headline", group: "lead" },
  { key: "role", label: "Job title", group: "lead" },
  { key: "about", label: "Biography", group: "lead" },
  { key: "location", label: "Location", group: "lead" },
  { key: "company", label: "Company name", group: "company" },
  { key: "company_overview", label: "Company Overview", group: "company" },
];

/** Display label for a variable key (falls back to the raw key). */
export function variableLabel(key: string): string {
  return VARIABLE_REGISTRY.find((v) => v.key === key)?.label ?? key;
}
