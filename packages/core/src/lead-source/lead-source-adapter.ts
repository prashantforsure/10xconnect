// The LEAD-SOURCING boundary (CLAUDE.md §8 "Lead sourcing & contacts", Step 13).
//
// This is intentionally a SEPARATE interface from ChannelAdapter (§5). They are
// different concerns:
//   - ChannelAdapter  = messaging/transport (send, read, inbound events) per account.
//   - LeadSourceAdapter = discovering candidate leads from a LinkedIn-derived
//                         source (search/sales-nav/event/post/group/lead-finder).
// Keeping them apart means the LinkedIn search surface can evolve without
// touching the safety-critical messaging contract, and lets the two be
// implemented/owned independently.
//
// RULE (same as ChannelAdapter): ZERO provider/SDK imports in this package.
// Adapters in packages/adapters translate provider payloads to/from these shapes.

/**
 * The LinkedIn-derived sources that resolve via this adapter.
 *
 * `connections` is the connected account's OWN 1st-degree relations ("my
 * network"), not prospect discovery — but it pages identical `SourcedLead`
 * results, so it rides the same read verb. It carries neither a `url` nor
 * `keywords`; the adapter lists the account owner's relations directly.
 */
export type LeadSourceKind =
  | "linkedin_search"
  | "sales_navigator"
  | "event"
  | "post"
  | "group"
  | "lead_finder"
  | "connections";

/** Structured filters for the built-in lead finder (CLAUDE.md §8 /leads/find). */
export interface LeadFinderFilters {
  title?: string;
  company?: string;
  location?: string;
  industry?: string;
  /** 1 = 1st-degree, 2 = 2nd, 3 = 3rd. */
  connectionDegree?: number;
  /** Free-text keywords across the LinkedIn-derived index. */
  keywords?: string;
}

/**
 * A source query. `url` carries the search/sales-nav/event/post/group link;
 * `filters`/`keywords` drive lead_finder. The adapter pages results — callers
 * pass `cursor` to continue and `limit` to bound a page (the orchestration layer
 * is responsible for clamping totals for account safety, §6).
 */
export interface LeadSourceQuery {
  kind: LeadSourceKind;
  /** Source link for url-based kinds (search/sales_navigator/event/post/group). */
  url?: string;
  /** Free-text keywords (lead_finder, and refinement on search). */
  keywords?: string;
  /** Structured filters (lead_finder). */
  filters?: LeadFinderFilters;
  /** For kind: "post" — pull people who liked, commented, or both. */
  engagement?: "likers" | "commenters" | "both";
  /** Max leads to return in this page. */
  limit?: number;
  /** Opaque pagination cursor from a previous LeadSourceResult.nextCursor. */
  cursor?: string;
}

/**
 * Reference to the sending account whose authenticated LinkedIn session performs
 * the search (mirrors AccountRef from the messaging boundary). DB-free: carries
 * our correlation id plus the provider-addressable handle.
 */
export interface LeadSourceAccountRef {
  /** Our sending_accounts.id. */
  accountId: string;
  /** Provider session/account handle the adapter actually addresses. */
  providerAccountId?: string;
}

/**
 * A candidate lead discovered by a source, BEFORE it is persisted/deduped/
 * enriched. A subset of EnrichedProfile fields the source can cheaply provide;
 * full enrichment happens later via ChannelAdapter.fetchProfile (Step 14).
 */
export interface SourcedLead {
  linkedinUrl?: string;
  email?: string;
  /** Provider member/profile id, if the source exposes one. */
  providerId?: string;
  firstName?: string;
  lastName?: string;
  /** Profile photo URL (LinkedIn avatar), if the source exposes one. */
  avatarUrl?: string;
  headline?: string;
  company?: string;
  role?: string;
  location?: string;
  /** 1 = 1st-degree, 2 = 2nd, 3 = 3rd. */
  connectionDegree?: number;
}

export interface LeadSourceResult {
  leads: SourcedLead[];
  /** Present when more results remain; pass back as LeadSourceQuery.cursor. */
  nextCursor?: string;
  /** Provider-reported total match count, when known. */
  total?: number;
}

/**
 * The lead-sourcing transport boundary. A single paged read verb keeps the
 * surface minimal; the import engine (Step 12/13) loops over pages and feeds
 * results through the shared dedupe → persist → enrich pipeline.
 */
export interface LeadSourceAdapter {
  fetchLeads(
    account: LeadSourceAccountRef,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult>;
}
