// Methodology guardrails (CLAUDE.md §2 "thou shalt not sell"; §6 hygiene). These
// are ADVISORY (non-blocking) — they encode the "start conversations, don't sell"
// playbook as warnings, never hard stops. The only HARD rules remain the rate caps.
// Pure + shared by the composer (linter, framework snippets) and the launch flow
// (profile audit).

import { renderMessageBody } from "./render";
import type { MessageBody } from "./segments";

export type LintSeverity = "warn" | "info";

export interface LintFinding {
  id: string;
  severity: LintSeverity;
  message: string;
}

const SALESY_PHRASES = [
  "our solution",
  "our product",
  "our platform",
  "our software",
  "we help companies",
  "we offer",
  "i'd love to show you",
  "let me show you",
  "check out our",
  "special offer",
  "limited time",
  "discount",
  "free trial",
  "cutting-edge",
  "best-in-class",
  "game-changer",
  "game changer",
  "synergy",
  "revolutionary",
  "world-class",
  "roi",
];

const HARD_CTAS = [
  "book a call",
  "book a demo",
  "schedule a call",
  "schedule a demo",
  "hop on a call",
  "jump on a call",
  "get on a call",
  "set up a call",
  "buy now",
  "sign up now",
  "15 minutes",
  "15 min",
  "quick call",
];

const LINK_RE = /\b(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|io|co|ai|net|org|app)\b/i;

const MAX_WORDS = 50;

/**
 * Lint a message body's plain text for "salesy" smells. Non-blocking warnings:
 * salesy phrases, links in a first-touch message, hard CTAs, and over-length.
 */
export function lintMessage(text: string, opts: { firstTouch?: boolean } = {}): LintFinding[] {
  const findings: LintFinding[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return findings;
  }
  const lower = trimmed.toLowerCase();

  const salesyHit = SALESY_PHRASES.find((p) => lower.includes(p));
  if (salesyHit) {
    findings.push({
      id: "salesy",
      severity: "warn",
      message: `Sounds salesy ("${salesyHit}"). Lead with a genuine observation instead of a pitch.`,
    });
  }

  const ctaHit = HARD_CTAS.find((c) => lower.includes(c));
  if (ctaHit) {
    findings.push({
      id: "hard_cta",
      severity: "warn",
      message: `Hard CTA ("${ctaHit}"). A soft, low-friction question converts better on a first touch.`,
    });
  }

  if (LINK_RE.test(trimmed) && (opts.firstTouch ?? true)) {
    findings.push({
      id: "link",
      severity: "warn",
      message: "Link in a first message hurts deliverability and acceptance. Save links for later.",
    });
  }

  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) {
    findings.push({
      id: "length",
      severity: "warn",
      message: `${words} words — long messages get skimmed. Aim for under ${MAX_WORDS}.`,
    });
  }

  return findings;
}

/**
 * The composer's live lint pipeline (CLAUDE.md §7): render a structured body to its
 * preview text (AI → placeholder, variables → fallback/skip — the no-broken-merge
 * render), then lint THAT text. The composer's GuardrailsPanel calls this on every
 * edit, so it's the exact "does the linter fire in the composer" path — and being
 * pure, it's unit-testable without rendering React.
 */
export function lintMessageBody(
  body: MessageBody,
  opts: { firstTouch?: boolean } = {},
): LintFinding[] {
  const text = renderMessageBody(body, {}, { renderAi: () => "[AI line]" });
  if (!text.trim()) {
    return [];
  }
  return lintMessage(text, { firstTouch: opts.firstTouch ?? true });
}

/** The portion of a message visible before the reader has to scroll/expand. */
export function aboveTheFold(text: string, limit = 140): { visible: string; truncated: boolean } {
  const firstChunk = text.split("\n").slice(0, 2).join("\n");
  const base = firstChunk.length <= text.length ? firstChunk : text;
  if (base.length <= limit) {
    return { visible: base, truncated: base.length < text.trim().length };
  }
  return { visible: `${base.slice(0, limit).trimEnd()}…`, truncated: true };
}

// --- Two-part framework defaults (observation + soft question) --------------

export const OBSERVATION_SNIPPETS: readonly string[] = [
  "saw you're scaling the team",
  "noticed your push into a new market",
  "love the direction you're taking the product",
  "saw your recent post on the topic",
  "impressed by the traction lately",
];

export const SOFT_QUESTION_SNIPPETS: readonly string[] = [
  "what's your main focus this quarter?",
  "how are you thinking about it?",
  "curious how you're approaching that?",
  "is that a priority right now?",
  "open to swapping notes on it?",
];

/**
 * The default opener body: an AI-personalized observation followed by a soft,
 * low-friction question (the §2 default message pattern). Insertable from the
 * composer toolbar.
 */
export function frameworkOpenerBody(): MessageBody {
  return {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: ", " },
      {
        type: "ai",
        prompt:
          "Write one short, genuine observation about this lead's recent work — casual, lowercase, no pitch.",
      },
      { type: "text", text: ". " },
      { type: "text", text: SOFT_QUESTION_SNIPPETS[0] },
    ],
  };
}

// --- Profile-readiness audit (run before "Run it!") -------------------------

export type AuditSeverity = "warn" | "info" | "ok";

export interface ProfileAuditItem {
  id: string;
  severity: AuditSeverity;
  message: string;
}

const SALES_HEADLINE_PREFIXES = ["sales", "sdr", "ae ", "ae,", "bd ", "bd,", "account executive", "business development"];

export interface AuditableAccount {
  name?: string | null;
  status?: string | null;
  headline?: string | null;
  hasPhoto?: boolean | null;
  lastActivityAt?: string | null;
}

/**
 * Advisory pre-launch checks on the sending account: profile photo, a headline
 * that doesn't read as a sales title, and recent activity. Where data isn't
 * available we return an "info" reminder rather than a false pass — never blocks.
 */
export function auditAccountProfile(account: AuditableAccount): ProfileAuditItem[] {
  const items: ProfileAuditItem[] = [];

  if (account.hasPhoto === false) {
    items.push({ id: "photo", severity: "warn", message: "Add a profile photo — no-photo accounts get accepted far less." });
  } else if (account.hasPhoto == null) {
    items.push({ id: "photo", severity: "info", message: "Make sure your LinkedIn profile has a clear photo." });
  }

  const headline = (account.headline ?? "").trim().toLowerCase();
  if (headline && SALES_HEADLINE_PREFIXES.some((p) => headline.startsWith(p))) {
    items.push({
      id: "headline",
      severity: "warn",
      message: "Your headline reads as a sales title — that lowers acceptance. Lead with the value you bring.",
    });
  } else if (!headline) {
    items.push({ id: "headline", severity: "info", message: "Ensure your headline isn't a sales/SDR/AE/BD title." });
  }

  if (!account.lastActivityAt) {
    items.push({ id: "activity", severity: "info", message: "Post or engage on LinkedIn recently — an active profile looks human." });
  }

  if (account.status && account.status !== "active") {
    items.push({ id: "status", severity: "warn", message: `Account status is "${account.status}". Connect/resume it before launching.` });
  }

  return items;
}
