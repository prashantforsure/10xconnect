// Pure mapping helpers for the Unipile lead-source adapter. No network here, so
// these are unit-tested directly (see unipile-lead-source-mapping.test.ts). The
// HTTP/paging orchestration lives in unipile-lead-source-adapter.ts.

import type { LeadSourceKind, SourcedLead } from "@10xconnect/core";

import { mapConnectionDegree } from "../unipile/mappers";
import type {
  UnipileRelationItem,
  UnipileSearchItem,
  UnipileSearchRequest,
} from "../unipile/unipile-types";

/** Which LinkedIn search surface a source kind queries. */
export function searchApiForKind(kind: LeadSourceKind): UnipileSearchRequest["api"] {
  return kind === "sales_navigator" ? "sales_navigator" : "classic";
}

/**
 * Build the POST /api/v1/linkedin/search body for a source query. A parsed
 * search `url` (linkedin_search / sales_navigator / event / group) takes
 * precedence; otherwise free-text `keywords` drives a classic search
 * (lead_finder). lead_finder filters are folded into the keyword string as a
 * best-effort — structured LinkedIn facets need entity ids we don't resolve here.
 */
export function buildSearchRequest(query: {
  kind: LeadSourceKind;
  url?: string;
  keywords?: string;
  filters?: {
    title?: string;
    company?: string;
    location?: string;
    industry?: string;
    keywords?: string;
  };
}): UnipileSearchRequest {
  const api = searchApiForKind(query.kind);
  if (query.url) {
    return { api, category: "people", url: query.url };
  }
  const keywords = composeKeywords(query.keywords, query.filters);
  return { api, category: "people", keywords };
}

function composeKeywords(
  keywords: string | undefined,
  filters?: { title?: string; company?: string; location?: string; industry?: string; keywords?: string },
): string {
  const parts = [
    keywords,
    filters?.keywords,
    filters?.title,
    filters?.company,
    filters?.location,
    filters?.industry,
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  // De-dupe while preserving order (a keyword may repeat across fields).
  return [...new Set(parts)].join(" ");
}

/**
 * Map a Unipile search/engagement row to a SourcedLead. Returns undefined when
 * the row has no usable identifier (no providerId, LinkedIn URL, or public id) —
 * such rows can't be persisted or deduped, so they're dropped.
 */
export function mapSearchItemToSourcedLead(raw: UnipileSearchItem): SourcedLead | undefined {
  // Engagement endpoints (reactions/comments) nest the person under author/actor.
  const item: UnipileSearchItem = raw.author ?? raw.actor ?? raw;

  const providerId = item.provider_id ?? item.id ?? item.member_id;
  const linkedinUrl = profileUrl(item);
  if (!providerId && !linkedinUrl) {
    return undefined;
  }

  const { firstName, lastName } = splitName(item);
  const lead: SourcedLead = {};
  if (linkedinUrl) lead.linkedinUrl = linkedinUrl;
  if (providerId) lead.providerId = providerId;
  if (firstName) lead.firstName = firstName;
  if (lastName) lead.lastName = lastName;
  const avatarUrl = pictureUrl(item);
  if (avatarUrl) lead.avatarUrl = avatarUrl;
  const headline = item.headline ?? item.occupation;
  if (headline) lead.headline = headline;
  const company = item.current_company ?? item.company;
  if (company) lead.company = company;
  if (item.occupation) lead.role = item.occupation;
  if (item.location) lead.location = item.location;
  const degree = mapConnectionDegree(item.network_distance);
  if (degree !== undefined) lead.connectionDegree = degree;
  return lead;
}

/**
 * Map a Unipile relations row (the account owner's 1st-degree connection) to a
 * SourcedLead. Relations are always 1st-degree, so connectionDegree is fixed at
 * 1. Returns undefined when the row has no usable identifier.
 */
export function mapRelationItemToSourcedLead(item: UnipileRelationItem): SourcedLead | undefined {
  const providerId = item.provider_id ?? item.member_id ?? item.member_urn;
  const linkedinUrl = profileUrl(item);
  if (!providerId && !linkedinUrl) {
    return undefined;
  }
  const { firstName, lastName } = splitName(item);
  const lead: SourcedLead = { connectionDegree: 1 };
  if (linkedinUrl) lead.linkedinUrl = linkedinUrl;
  if (providerId) lead.providerId = providerId;
  if (firstName) lead.firstName = firstName;
  if (lastName) lead.lastName = lastName;
  const avatarUrl = pictureUrl(item);
  if (avatarUrl) lead.avatarUrl = avatarUrl;
  const headline = item.headline ?? item.occupation;
  if (headline) lead.headline = headline;
  const company = item.current_company ?? item.company;
  if (company) lead.company = company;
  if (item.occupation) lead.role = item.occupation;
  if (item.location) lead.location = item.location;
  return lead;
}

function profileUrl(item: UnipileSearchItem | UnipileRelationItem): string | undefined {
  const explicit = item.public_profile_url ?? item.profile_url;
  if (explicit && /linkedin\.com\/in\//i.test(explicit)) {
    return explicit;
  }
  if (item.public_identifier) {
    return `https://www.linkedin.com/in/${item.public_identifier}`;
  }
  return undefined;
}

/** Best-available profile photo URL across Unipile surfaces (naming varies). */
function pictureUrl(item: UnipileSearchItem | UnipileRelationItem): string | undefined {
  const url = item.profile_picture_url_large ?? item.profile_picture_url ?? item.picture_url;
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

function splitName(
  item: UnipileSearchItem | UnipileRelationItem,
): { firstName?: string; lastName?: string } {
  if (item.first_name || item.last_name) {
    return { firstName: item.first_name, lastName: item.last_name };
  }
  const name = item.name?.trim();
  if (!name) {
    return {};
  }
  const space = name.indexOf(" ");
  if (space === -1) {
    return { firstName: name };
  }
  return { firstName: name.slice(0, space), lastName: name.slice(space + 1).trim() };
}

/**
 * Extract the numeric LinkedIn post/activity id from a feed/post URL or a bare
 * activity urn (e.g. ".../urn:li:activity:7212345678901234567/" → that number).
 * Used to address the reactions/comments endpoints for post-engagement sourcing.
 */
export function extractPostActivityId(url: string): string | undefined {
  const urn = url.match(/urn:li:(?:activity|share|ugcPost):(\d+)/i);
  if (urn) {
    return urn[1];
  }
  // Some share URLs end in "...-<19-digit-id>" or carry the id as the last path segment.
  const trailing = url.match(/(\d{15,25})/);
  return trailing ? trailing[1] : undefined;
}
