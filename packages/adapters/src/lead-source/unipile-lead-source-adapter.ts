import type {
  LeadSourceAccountRef,
  LeadSourceAdapter,
  LeadSourceQuery,
  LeadSourceResult,
  SourcedLead,
} from "@10xconnect/core";

import { mapHttpError } from "../unipile/mappers";
import { UnipileClient } from "../unipile/unipile-client";
import type {
  UnipileConfig,
  UnipileRelationsResponse,
  UnipileSearchResponse,
} from "../unipile/unipile-types";

import {
  buildSearchRequest,
  extractPostActivityId,
  mapRelationItemToSourcedLead,
  mapSearchItemToSourcedLead,
} from "./unipile-lead-source-mappers";

/**
 * Real LinkedIn lead sourcing over the Unipile REST API, behind the
 * LeadSourceAdapter contract (packages/core). This is the ONLY place Unipile's
 * HTTP/types are touched for sourcing (mirrors UnipileChannelAdapter, §4).
 *
 * Sources → Unipile surface:
 *   - linkedin_search → POST /linkedin/search (api "classic", people).
 *   - sales_navigator → POST /linkedin/search (api "sales_navigator", people).
 *   - lead_finder     → POST /linkedin/search (classic, free-text keywords).
 *   - post            → GET  /posts/{id}/reactions|comments (likers/commenters).
 *   - event / group   → best-effort: the source URL is handed to classic search;
 *                       to confirm in live test (LinkedIn may need a dedicated path).
 *
 * Errors NEVER cross this boundary raw: provider failures are mapped to a clean
 * message and re-thrown, so the import engine records a readable job error
 * instead of leaking Unipile internals. The orchestration/import layer clamps
 * totals for account safety (§6); this adapter fetches only what it is asked for.
 */
export class UnipileLeadSourceAdapter implements LeadSourceAdapter {
  private readonly client: UnipileClient;

  constructor(config: UnipileConfig) {
    this.client = new UnipileClient(config);
  }

  async fetchLeads(
    account: LeadSourceAccountRef,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    try {
      if (query.kind === "connections") {
        return await this.fetchRelations(account, query);
      }
      if (query.kind === "post") {
        return await this.fetchPostEngagement(account, query);
      }
      return await this.fetchSearch(account, query);
    } catch (err) {
      // Surface a clean message (e.g. "unipile: account not found") — the import
      // engine stores this as the job error. No raw provider payloads leak out.
      throw new Error(mapHttpError(err).message);
    }
  }

  // --- search (classic / sales-nav / lead-finder / event / group) -----------

  private async fetchSearch(
    account: LeadSourceAccountRef,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    const body = buildSearchRequest(query);
    const res = await this.client.postJson<UnipileSearchResponse>(
      "/api/v1/linkedin/search",
      body,
      { account_id: this.acc(account), cursor: query.cursor, limit: pageLimit(query.limit) },
    );
    return toResult(res);
  }

  // --- connections (the account owner's 1st-degree relations) ----------------

  private async fetchRelations(
    account: LeadSourceAccountRef,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    const res = await this.client.getJson<UnipileRelationsResponse>("/api/v1/users/relations", {
      account_id: this.acc(account),
      cursor: query.cursor,
      limit: pageLimit(query.limit),
    });
    const leads: SourcedLead[] = [];
    for (const item of res.items ?? []) {
      const lead = mapRelationItemToSourcedLead(item);
      if (lead) {
        leads.push(lead);
      }
    }
    const result: LeadSourceResult = { leads };
    if (res.cursor) {
      result.nextCursor = res.cursor;
    }
    const total = res.paging?.total_count ?? res.paging?.total;
    if (typeof total === "number") {
      result.total = total;
    }
    return result;
  }

  // --- post engagement (likers / commenters) --------------------------------

  private async fetchPostEngagement(
    account: LeadSourceAccountRef,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    const postId = query.url ? extractPostActivityId(query.url) : undefined;
    if (!postId) {
      throw new Error("unipile: could not extract a post id from the provided URL");
    }
    if (query.engagement === "both") {
      return this.fetchPostBoth(account, postId, query);
    }
    const path =
      query.engagement === "commenters"
        ? `/api/v1/posts/${encodeURIComponent(postId)}/comments`
        : `/api/v1/posts/${encodeURIComponent(postId)}/reactions`;
    const res = await this.client.getJson<UnipileSearchResponse>(path, {
      account_id: this.acc(account),
      cursor: query.cursor,
      limit: pageLimit(query.limit),
    });
    return toResult(res);
  }

  /**
   * engagement: "both" — page through reactions fully, THEN comments, using a
   * phase-prefixed cursor ("r:"/"c:"). The import engine's per-workspace dedupe
   * collapses anyone who both liked and commented, so the merged set has no dups.
   */
  private async fetchPostBoth(
    account: LeadSourceAccountRef,
    postId: string,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    const reactions = `/api/v1/posts/${encodeURIComponent(postId)}/reactions`;
    const comments = `/api/v1/posts/${encodeURIComponent(postId)}/comments`;
    const cursor = query.cursor;
    const params = (c: string | undefined) => ({
      account_id: this.acc(account),
      cursor: c,
      limit: pageLimit(query.limit),
    });

    if (cursor?.startsWith("c:")) {
      const res = await this.client.getJson<UnipileSearchResponse>(comments, params(cursor.slice(2) || undefined));
      const out = toResult(res);
      out.nextCursor = res.cursor ? `c:${res.cursor}` : undefined;
      return out;
    }

    const reactCursor = cursor?.startsWith("r:") ? cursor.slice(2) || undefined : cursor;
    const res = await this.client.getJson<UnipileSearchResponse>(reactions, params(reactCursor));
    const out = toResult(res);
    // Reactions exhausted with nothing on this page → roll straight into comments.
    if (out.leads.length === 0 && !res.cursor) {
      return this.fetchPostBoth(account, postId, { ...query, cursor: "c:" });
    }
    out.nextCursor = res.cursor ? `r:${res.cursor}` : "c:";
    return out;
  }

  /** The Unipile account id the API addresses (provider handle, else our id). */
  private acc(account: LeadSourceAccountRef): string {
    return account.providerAccountId ?? account.accountId;
  }
}

/** Map a raw Unipile search/engagement response to our paged LeadSourceResult. */
function toResult(res: UnipileSearchResponse): LeadSourceResult {
  const leads: SourcedLead[] = [];
  for (const item of res.items ?? []) {
    const lead = mapSearchItemToSourcedLead(item);
    if (lead) {
      leads.push(lead);
    }
  }
  const result: LeadSourceResult = { leads };
  if (res.cursor) {
    result.nextCursor = res.cursor;
  }
  const total = res.paging?.total_count ?? res.paging?.total;
  if (typeof total === "number") {
    result.total = total;
  }
  return result;
}

/** Bound a single page request (account safety §6); the engine pages the rest. */
function pageLimit(limit: number | undefined): string | undefined {
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }
  return String(Math.min(Math.floor(limit), 100));
}
