// Contact-variable resolver (Phase 5, pure). Turns a lead's enrichment + custom
// columns (+ sender) into the final value for every registry variable, applying:
//   raw value → if empty/stale → fallback → else the on_missing policy.
// Activity fields go stale after their freshnessDays (a fresh profile read would
// be needed — and that read costs profile-visit budget, so we don't do it here).
// The output feeds renderMessageBody, which drops empty chips (no broken merges)
// and, for skip_sentence policy, drops the whole sentence.

import {
  CONTACT_VARIABLES,
  customColumn,
  isCustomKey,
  type OnMissing,
  type VariableEntry,
} from "./registry";

export interface VariableContext {
  enrichment: Record<string, unknown>;
  customColumns: Record<string, unknown>;
  linkedinUrl?: string | null;
  email?: string | null;
  connectionDegree?: number | null;
  sender?: { firstName?: string; company?: string };
  /** When the lead was last enriched (ISO) — drives activity freshness. */
  enrichedAt?: string | null;
  now?: Date;
}

export interface ResolvedVariables {
  /** key → final display value (raw, else fallback, else "" for blank/skip). */
  values: Record<string, string>;
  /** key → on_missing policy (the renderer uses skip_sentence). */
  policy: Record<string, OnMissing>;
  /** keys that resolved to a real (non-fallback) value — fed to the AI chip. */
  available: string[];
  /** keys with no real value (fallback used or blank). */
  missing: string[];
}

const DAY_MS = 86_400_000;

function s(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
function joinArr(value: unknown): string {
  return Array.isArray(value) ? value.map((v) => s(typeof v === "object" ? (v as { name?: unknown }).name : v)).filter(Boolean).join(", ") : "";
}
function postText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return s((value as { text?: unknown }).text);
  return "";
}
function firstPostText(value: unknown): string {
  if (Array.isArray(value) && value.length > 0) return postText(value[0]);
  return "";
}

/** Read the raw (pre-fallback) value for a variable key from the context. */
function rawValue(key: string, ctx: VariableContext): string {
  const e = ctx.enrichment;
  switch (key) {
    case "firstName": return s(e.firstName);
    case "lastName": return s(e.lastName);
    case "fullName": return [s(e.firstName), s(e.lastName)].filter(Boolean).join(" ");
    case "username": return s(e.username);
    case "email": return s(ctx.email) || s(e.email);
    case "headline": return s(e.headline);
    case "location": return s(e.location);
    case "profileUrl": return s(ctx.linkedinUrl) || s(e.linkedinUrl);
    case "jobTitle": return s(e.jobTitle) || s(e.role) || s(e.title);
    case "seniority": return s(e.seniority);
    case "biography": return s(e.biography) || s(e.about) || s(e.bio);
    case "workExperience": return s(e.workExperience) || joinArr(e.experience);
    case "yearsInRole": return s(e.yearsInRole);
    case "education": return s(e.education) || joinArr(e.schools);
    case "skills": return joinArr(e.skills);
    case "companyName": return s(e.companyName) || s(e.company);
    case "companyOverview": return s(e.companyOverview);
    case "companyUrl": return s(e.companyUrl);
    case "companyWebsite": return s(e.companyWebsite) || s(e.website);
    case "industry": return s(e.industry);
    case "companySize": return s(e.companySize);
    case "companyHQ": return s(e.companyHQ) || s(e.companyHq);
    case "lastPost": return postText(e.lastPost) || firstPostText(e.recentPosts);
    case "lastRepost": return postText(e.lastRepost);
    case "lastPostDate": return s(e.lastPostDate);
    case "recentActivitySummary": return s(e.recentActivitySummary);
    case "mutualConnections": return s(e.mutualConnections);
    case "sharedGroups": return joinArr(e.sharedGroups);
    case "senderFirstName": return s(ctx.sender?.firstName);
    case "senderCompany": return s(ctx.sender?.company);
    case "connectionDegree": return ctx.connectionDegree != null ? String(ctx.connectionDegree) : "";
    default:
      if (isCustomKey(key)) return s(ctx.customColumns[customColumn(key)]);
      return s(e[key]);
  }
}

/** Is an activity value stale (older than freshnessDays since enrichment)? */
function isStale(entry: VariableEntry, ctx: VariableContext): boolean {
  if (!entry.freshnessDays || !ctx.enrichedAt) return false;
  const enrichedMs = new Date(ctx.enrichedAt).getTime();
  if (!Number.isFinite(enrichedMs)) return false;
  const now = (ctx.now ?? new Date()).getTime();
  return now - enrichedMs > entry.freshnessDays * DAY_MS;
}

/**
 * Resolve a single variable key to its final value + policy.
 * value → if empty/stale → fallback → else "" (renderer applies skip/blank policy).
 */
export function resolveVariable(entry: VariableEntry, ctx: VariableContext): { value: string; hadValue: boolean } {
  const stale = isStale(entry, ctx);
  const raw = stale ? "" : rawValue(entry.key, ctx);
  if (raw) return { value: raw, hadValue: true };
  if (entry.fallback && entry.fallback.trim()) return { value: entry.fallback.trim(), hadValue: false };
  return { value: "", hadValue: false }; // renderer applies skip_sentence / leave_blank
}

/** Resolve every registry variable (+ any custom keys requested) for a lead. */
export function resolveContactVariables(ctx: VariableContext, extraKeys: string[] = []): ResolvedVariables {
  const values: Record<string, string> = {};
  const policy: Record<string, OnMissing> = {};
  const available: string[] = [];
  const missing: string[] = [];

  const entries: VariableEntry[] = [...CONTACT_VARIABLES];
  for (const key of extraKeys) {
    if (isCustomKey(key) && !entries.some((e) => e.key === key)) {
      entries.push({ key, label: customColumn(key), group: "custom", source: "enrichment", onMissing: "leave_blank" });
    }
  }

  for (const entry of entries) {
    const { value, hadValue } = resolveVariable(entry, ctx);
    values[entry.key] = value;
    policy[entry.key] = entry.onMissing;
    (hadValue ? available : missing).push(entry.key);
  }

  // Legacy snake_case aliases (the composer's original VARIABLE_REGISTRY keys), so
  // existing message bodies keep rendering against the richer registry values.
  for (const [legacy, modern] of Object.entries(LEGACY_ALIASES)) {
    values[legacy] = values[modern] ?? "";
    policy[legacy] = policy[modern] ?? "leave_blank";
  }
  return { values, policy, available, missing };
}

// Original composer keys → new registry keys (see packages/core/src/composer/segments.ts).
const LEGACY_ALIASES: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  full_name: "fullName",
  company: "companyName",
  company_overview: "companyOverview",
  role: "jobTitle",
  headline: "headline",
  about: "biography",
  location: "location",
  linkedin_url: "profileUrl",
  email: "email",
};
