// Lead identity + workspace dedupe (CLAUDE.md §10: leads carry a dedupe_key; the
// DB enforces one dedupe_key per workspace). The dedupe_key is derived here so
// every import source (CSV + all LeadSourceAdapter sources) dedupes identically.
// Pure functions — no provider/SDK or node imports.

export interface LeadIdentity {
  linkedinUrl?: string | null;
  email?: string | null;
}

/**
 * Canonicalize a LinkedIn profile URL to its stable `/in/<slug>` identity so
 * `https://www.LinkedIn.com/in/Jane-Doe/?utm=x` and `linkedin.com/in/jane-doe`
 * collapse to the same key. Returns undefined when the input is not a usable
 * profile URL.
 */
export function normalizeLinkedinUrl(url: string | null | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  if (trimmed === "") {
    return undefined;
  }

  // Strip scheme, query, and fragment; lowercase the whole thing for matching.
  let rest = trimmed.toLowerCase();
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  rest = rest.replace(/[?#].*$/, "");
  rest = rest.replace(/\/+$/, "");

  // Match a profile slug under /in/ (people) — the canonical LinkedIn identity.
  const match = rest.match(/linkedin\.com\/in\/([^/]+)/);
  if (!match) {
    return undefined;
  }
  const slug = decodeURIComponent(match[1]!);
  return `linkedin.com/in/${slug}`;
}

/**
 * True when `url` is a safe, http(s) LinkedIn URL. Used to gate every stored /
 * rendered `linkedin_url` so a `javascript:` / `data:` / `file:` URL — all of
 * which pass a permissive `z.string().url()` — can never be persisted and later
 * rendered as a clickable `href` (XSS). Requires an https/http scheme and a host
 * that is `linkedin.com` or a subdomain of it. Pure — no node/SDK imports.
 */
export function isLinkedinHttpUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  return /(^|\.)linkedin\.com$/.test(parsed.hostname.toLowerCase());
}

/** Trim + lowercase an email, returning undefined when it isn't email-shaped. */
export function normalizeEmail(email: string | null | undefined): string | undefined {
  if (!email) {
    return undefined;
  }
  const normalized = email.trim().toLowerCase();
  // Deliberately permissive: a single @ with non-empty local + domain parts.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Derive the workspace dedupe key for a lead. LinkedIn identity wins (it is the
 * primary key for outreach); email is the fallback. Returns undefined when the
 * lead has neither usable identifier — such leads are NOT deduped (each is kept).
 */
export function deriveDedupeKey(identity: LeadIdentity): string | undefined {
  const linkedin = normalizeLinkedinUrl(identity.linkedinUrl);
  if (linkedin) {
    return `li:${linkedin}`;
  }
  const email = normalizeEmail(identity.email);
  if (email) {
    return `email:${email}`;
  }
  return undefined;
}
