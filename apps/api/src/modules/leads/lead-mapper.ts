import type { EnrichedProfile, MappedLeadInput, SourcedLead } from "@10xconnect/core";
import { deriveDedupeKey, normalizeEmail } from "@10xconnect/core";
import type { Tables } from "@10xconnect/db";

type LeadRow = Tables<"leads">;

/** Canonical enrichment shape stored in leads.enrichment (jsonb). */
export interface LeadEnrichment {
  firstName?: string;
  lastName?: string;
  /** Profile photo URL (LinkedIn avatar), when known. */
  avatarUrl?: string;
  headline?: string;
  about?: string;
  company?: string;
  role?: string;
  location?: string;
  connectionDegree?: number;
  recentPosts?: { postId: string; url?: string; text?: string; postedAt?: string }[];
  /** Provenance of these fields (e.g. "csv", "linkedin_search", "fetchProfile"). */
  source?: string;
}

/**
 * A normalized, pre-persist lead. CSV rows and LeadSourceAdapter results both
 * collapse to this shape so the dedupe → persist → enrich pipeline is uniform.
 */
export interface Candidate {
  linkedinUrl?: string;
  email?: string;
  providerId?: string;
  connectionDegree?: number;
  enrichment: LeadEnrichment;
  tags: string[];
  customColumns: Record<string, string>;
}

export interface LeadView {
  id: string;
  linkedinUrl: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  connectionDegree: number | null;
  tags: string[];
  customColumns: Record<string, unknown>;
  enrichStatus: LeadRow["enrich_status"];
  createdAt: string;
  updatedAt: string;
}

export function candidateFromMapped(input: MappedLeadInput, source: string): Candidate {
  return {
    linkedinUrl: input.linkedinUrl,
    email: normalizeEmail(input.email) ?? input.email,
    enrichment: pruneEnrichment({
      firstName: input.firstName,
      lastName: input.lastName,
      headline: input.headline,
      company: input.company,
      role: input.role,
      location: input.location,
      source,
    }),
    tags: input.tags,
    customColumns: input.customColumns,
  };
}

/**
 * A candidate from a manually-entered LinkedIn profile URL (profile_urls import).
 * Only the URL is known up front, so we derive a best-effort display name from
 * the /in/ vanity slug — the lead then shows a readable name immediately, before
 * async enrichment runs and even if enrichment later fails (out-of-network /
 * private profiles). Real enrichment (fetchProfile) overwrites it when available.
 */
export function candidateFromUrl(url: string): Candidate {
  const trimmed = url.trim();
  return {
    linkedinUrl: trimmed,
    enrichment: pruneEnrichment({ ...deriveNameFromLinkedInUrl(trimmed), source: "profile_urls" }),
    tags: [],
    customColumns: {},
  };
}

/**
 * Parse a LinkedIn /in/ vanity slug into a first/last name.
 * "jane-doe" → { firstName: "Jane", lastName: "Doe" };
 * "jane-doe-1a2b3c" → drops the trailing id token → { firstName: "Jane", lastName: "Doe" }.
 */
function deriveNameFromLinkedInUrl(url: string): { firstName?: string; lastName?: string } {
  const match = url.match(/\/in\/([^/?#]+)/i);
  if (!match) {
    return {};
  }
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    slug = match[1];
  }
  const tokens = slug.split("-").filter(Boolean);
  // LinkedIn appends a numeric/hex id to disambiguate duplicate vanity names
  // ("jane-doe-1a2b3c") — drop trailing id-like tokens (those containing a digit).
  while (tokens.length > 1 && /\d/.test(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  const named = tokens.filter((t) => /[a-z]/i.test(t));
  if (named.length === 0) {
    return {};
  }
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const firstName = cap(named[0]!);
  return named.length > 1
    ? { firstName, lastName: named.slice(1).map(cap).join(" ") }
    : { firstName };
}

export function candidateFromSourced(lead: SourcedLead, source: string): Candidate {
  return {
    linkedinUrl: lead.linkedinUrl,
    email: normalizeEmail(lead.email) ?? lead.email,
    providerId: lead.providerId,
    connectionDegree: lead.connectionDegree,
    enrichment: pruneEnrichment({
      firstName: lead.firstName,
      lastName: lead.lastName,
      avatarUrl: lead.avatarUrl,
      headline: lead.headline,
      company: lead.company,
      role: lead.role,
      location: lead.location,
      connectionDegree: lead.connectionDegree,
      source,
    }),
    tags: [],
    customColumns: {},
  };
}

/** Map a ChannelAdapter EnrichedProfile (Step 14) into our enrichment shape. */
export function enrichmentFromProfile(profile: EnrichedProfile): LeadEnrichment {
  return pruneEnrichment({
    firstName: profile.firstName,
    lastName: profile.lastName,
    avatarUrl: profile.avatarUrl,
    headline: profile.headline,
    about: profile.about,
    company: profile.company,
    role: profile.role,
    location: profile.location,
    connectionDegree: profile.connectionDegree,
    recentPosts: profile.recentPosts,
    source: "fetchProfile",
  });
}

/** Insert values for a NEW lead from a candidate (+ default tags from the import). */
export function buildLeadInsert(
  workspaceId: string,
  candidate: Candidate,
  defaultTags: string[],
  dedupeKey: string | undefined,
): {
  workspace_id: string;
  linkedin_url: string | null;
  email: string | null;
  enrichment: string;
  tags: string[];
  custom_columns: string;
  dedupe_key: string | null;
  connection_degree: number | null;
} {
  const tags = Array.from(new Set([...candidate.tags, ...defaultTags]));
  return {
    workspace_id: workspaceId,
    linkedin_url: candidate.linkedinUrl ?? null,
    email: candidate.email ?? null,
    enrichment: JSON.stringify(candidate.enrichment),
    tags,
    custom_columns: JSON.stringify(candidate.customColumns),
    dedupe_key: dedupeKey ?? null,
    connection_degree: candidate.connectionDegree ?? null,
  };
}

export function candidateDedupeKey(candidate: Candidate): string | undefined {
  return deriveDedupeKey({ linkedinUrl: candidate.linkedinUrl, email: candidate.email });
}

export function toLeadView(row: LeadRow): LeadView {
  const enrichment = asEnrichment(row.enrichment);
  const firstName = enrichment.firstName ?? null;
  const lastName = enrichment.lastName ?? null;
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;
  return {
    id: row.id,
    linkedinUrl: row.linkedin_url,
    email: row.email,
    firstName,
    lastName,
    name,
    avatarUrl: enrichment.avatarUrl ?? null,
    headline: enrichment.headline ?? null,
    company: enrichment.company ?? null,
    role: enrichment.role ?? null,
    location: enrichment.location ?? null,
    connectionDegree: row.connection_degree ?? enrichment.connectionDegree ?? null,
    tags: row.tags ?? [],
    customColumns: asRecord(row.custom_columns),
    enrichStatus: row.enrich_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function asEnrichment(value: unknown): LeadEnrichment {
  return asRecord(value) as LeadEnrichment;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pruneEnrichment(enrichment: LeadEnrichment): LeadEnrichment {
  const out: LeadEnrichment = {};
  for (const [key, value] of Object.entries(enrichment)) {
    if (value !== undefined && value !== null && value !== "") {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
