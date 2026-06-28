// Contact variable registry (Phase 5) — the full personalization palette matching
// the Prosp surface. Each entry declares WHERE its value comes from (`source`),
// how long it stays fresh (`freshnessDays` — activity needs a recent profile read),
// a default `fallback`, and the `onMissing` policy applied when there's no value
// and no fallback. Pure + shared by the composer palette, the resolver, and the
// AI-chip prompt (which is told which fields are actually present).

export type VariableGroup = "identity" | "role" | "company" | "activity" | "sender" | "custom";

/** Where a variable is sourced — `activity` requires a (budgeted) profile read. */
export type VariableSourceKind = "enrichment" | "profile" | "activity" | "company" | "sender" | "lead" | "derived";

/** What to do when a variable is empty/stale AND has no fallback. */
export type OnMissing = "skip_sentence" | "fallback" | "leave_blank";

export interface VariableEntry {
  key: string;
  label: string;
  group: VariableGroup;
  source: VariableSourceKind;
  /** Max age (days) before the value is treated as stale (activity fields). */
  freshnessDays?: number;
  /** Default fallback substituted when the value is empty/stale. */
  fallback?: string;
  /** Policy when empty/stale with no usable fallback. */
  onMissing: OnMissing;
}

// The full registry. `onMissing` defaults to leave_blank for safe identity/role
// fields and skip_sentence for activity (an empty post should drop its sentence,
// never render an empty bracket).
export const CONTACT_VARIABLES: VariableEntry[] = [
  // --- Identity -----------------------------------------------------------
  { key: "firstName", label: "First name", group: "identity", source: "enrichment", fallback: "there", onMissing: "fallback" },
  { key: "lastName", label: "Last name", group: "identity", source: "enrichment", onMissing: "leave_blank" },
  { key: "fullName", label: "Full name", group: "identity", source: "derived", fallback: "there", onMissing: "fallback" },
  { key: "username", label: "Username", group: "identity", source: "enrichment", onMissing: "leave_blank" },
  { key: "email", label: "Email", group: "identity", source: "lead", onMissing: "leave_blank" },
  { key: "headline", label: "Headline", group: "identity", source: "enrichment", onMissing: "skip_sentence" },
  { key: "location", label: "Location", group: "identity", source: "enrichment", onMissing: "leave_blank" },
  { key: "profileUrl", label: "Profile URL", group: "identity", source: "lead", onMissing: "leave_blank" },
  // --- Role / career ------------------------------------------------------
  { key: "jobTitle", label: "Job title", group: "role", source: "enrichment", fallback: "your role", onMissing: "fallback" },
  { key: "seniority", label: "Seniority", group: "role", source: "enrichment", onMissing: "leave_blank" },
  { key: "biography", label: "Biography", group: "role", source: "enrichment", onMissing: "skip_sentence" },
  { key: "workExperience", label: "Work experience", group: "role", source: "enrichment", onMissing: "skip_sentence" },
  { key: "yearsInRole", label: "Years in role", group: "role", source: "enrichment", onMissing: "leave_blank" },
  { key: "education", label: "Education", group: "role", source: "enrichment", onMissing: "leave_blank" },
  { key: "skills", label: "Skills", group: "role", source: "enrichment", onMissing: "leave_blank" },
  // --- Company ------------------------------------------------------------
  { key: "companyName", label: "Company name", group: "company", source: "company", fallback: "your company", onMissing: "fallback" },
  { key: "companyOverview", label: "Company overview", group: "company", source: "company", onMissing: "skip_sentence" },
  { key: "companyUrl", label: "Company URL", group: "company", source: "company", onMissing: "leave_blank" },
  { key: "companyWebsite", label: "Company website", group: "company", source: "company", onMissing: "leave_blank" },
  { key: "industry", label: "Industry", group: "company", source: "company", onMissing: "leave_blank" },
  { key: "companySize", label: "Company size", group: "company", source: "company", onMissing: "leave_blank" },
  { key: "companyHQ", label: "Company HQ", group: "company", source: "company", onMissing: "leave_blank" },
  // --- Activity (needs a fresh profile read → profile-visit budget) --------
  { key: "lastPost", label: "Last post", group: "activity", source: "activity", freshnessDays: 30, onMissing: "skip_sentence" },
  { key: "lastRepost", label: "Last repost", group: "activity", source: "activity", freshnessDays: 30, onMissing: "skip_sentence" },
  { key: "lastPostDate", label: "Last post date", group: "activity", source: "activity", freshnessDays: 30, onMissing: "leave_blank" },
  { key: "recentActivitySummary", label: "Recent activity", group: "activity", source: "activity", freshnessDays: 30, onMissing: "skip_sentence" },
  { key: "mutualConnections", label: "Mutual connections", group: "activity", source: "activity", freshnessDays: 30, onMissing: "leave_blank" },
  { key: "sharedGroups", label: "Shared groups", group: "activity", source: "activity", freshnessDays: 30, onMissing: "leave_blank" },
  // --- Sender + custom ----------------------------------------------------
  { key: "senderFirstName", label: "Sender first name", group: "sender", source: "sender", onMissing: "leave_blank" },
  { key: "senderCompany", label: "Sender company", group: "sender", source: "sender", onMissing: "leave_blank" },
  { key: "connectionDegree", label: "Connection degree", group: "sender", source: "lead", onMissing: "leave_blank" },
];

const BY_KEY = new Map(CONTACT_VARIABLES.map((v) => [v.key, v]));

/** Registry entry for a key, including dynamic `customField:x` / `custom:x` keys. */
export function variableEntry(key: string): VariableEntry | undefined {
  const hit = BY_KEY.get(key);
  if (hit) return hit;
  if (isCustomKey(key)) {
    return { key, label: customColumn(key), group: "custom", source: "enrichment", onMissing: "leave_blank" };
  }
  return undefined;
}

/** Activity variables consume the profile-visit budget (a fresh read is needed). */
export function isActivityVariable(key: string): boolean {
  return variableEntry(key)?.source === "activity";
}

const CUSTOM_PREFIXES = ["customField:", "custom:", "custom."];

export function isCustomKey(key: string): boolean {
  return CUSTOM_PREFIXES.some((p) => key.startsWith(p));
}

/** The underlying CSV/custom-column name for a `customField:x` / `custom:x` key. */
export function customColumn(key: string): string {
  for (const p of CUSTOM_PREFIXES) {
    if (key.startsWith(p)) return key.slice(p.length);
  }
  return key;
}
