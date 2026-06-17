import type { AccountRef, ChannelAdapter, EnrichedProfile } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Kysely } from "kysely";

import { CHANNEL_ADAPTER } from "../../adapter/channel-adapter.module";
import { KYSELY_DB } from "../../database/database.module";

import { asEnrichment, enrichmentFromProfile, type LeadEnrichment } from "./lead-mapper";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

/**
 * Async lead enrichment (Step 14, CLAUDE.md §8 /leads/:id/enrich). Calls the
 * ChannelAdapter's fetchProfile (mock in Phase 3) to populate headline/about/
 * company/role/recent posts/connection degree, transitions enrich_status
 * (pending → enriching → enriched|failed), and retries with backoff. Failures
 * surface as a `failed` status — never a crash (account restriction etc. is a
 * domain event, §2).
 */
@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger("EnrichmentService");

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: ChannelAdapter,
  ) {}

  /**
   * Fire-and-forget enrichment for a batch of leads (used right after import).
   * Runs in the background so it never blocks the import response; each lead is
   * isolated so one failure can't sink the rest.
   */
  scheduleEnrichment(workspaceId: string, leadIds: string[]): void {
    if (leadIds.length === 0) {
      return;
    }
    setImmediate(() => {
      void this.runBatch(workspaceId, leadIds);
    });
  }

  private async runBatch(workspaceId: string, leadIds: string[]): Promise<void> {
    const account = await this.resolveAccount(workspaceId);
    for (const leadId of leadIds) {
      try {
        await this.enrichLead(workspaceId, leadId, account);
      } catch (err) {
        // enrichLead already records `failed`; this guards the loop.
        this.logger.warn(`Enrichment failed for lead ${leadId}: ${String(err)}`);
      }
    }
  }

  /**
   * Enrich a single lead. Returns the final enrich_status. Safe to call directly
   * (POST /leads/:id/enrich) or from the batch runner.
   */
  async enrichLead(
    workspaceId: string,
    leadId: string,
    account?: AccountRef,
  ): Promise<"enriched" | "failed" | "skipped"> {
    const lead = await this.db
      .selectFrom("leads")
      .select(["id", "linkedin_url", "email", "enrichment", "connection_degree"])
      .where("id", "=", leadId)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    if (!lead) {
      return "skipped";
    }

    // No LinkedIn URL → nothing to fetch. Settle the status so it isn't stuck
    // 'pending' forever (the lead keeps whatever fields the import provided).
    if (!lead.linkedin_url) {
      await this.setStatus(workspaceId, leadId, "enriched");
      return "skipped";
    }

    await this.setStatus(workspaceId, leadId, "enriching");
    const ref = account ?? (await this.resolveAccount(workspaceId));

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const profile = await this.adapter.fetchProfile(ref, lead.linkedin_url);
        await this.applyProfile(workspaceId, leadId, lead, profile);
        return "enriched";
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        }
      }
    }

    this.logger.warn(
      `fetchProfile failed for lead ${leadId} after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`,
    );
    await this.setStatus(workspaceId, leadId, "failed");
    return "failed";
  }

  private async applyProfile(
    workspaceId: string,
    leadId: string,
    lead: { enrichment: unknown; email: string | null; connection_degree: number | null },
    profile: EnrichedProfile,
  ): Promise<void> {
    const existing = asEnrichment(lead.enrichment);
    const merged: LeadEnrichment = { ...existing, ...enrichmentFromProfile(profile) };

    await this.db
      .updateTable("leads")
      .set({
        enrichment: JSON.stringify(merged),
        enrich_status: "enriched",
        connection_degree: profile.connectionDegree ?? lead.connection_degree ?? null,
        // Only fill an email we didn't already have (never clobber a real one).
        ...(profile.email && !lead.email ? { email: profile.email.toLowerCase() } : {}),
      })
      .where("id", "=", leadId)
      .where("workspace_id", "=", workspaceId)
      .execute();
  }

  private async setStatus(
    workspaceId: string,
    leadId: string,
    status: "pending" | "enriching" | "enriched" | "failed",
  ): Promise<void> {
    await this.db
      .updateTable("leads")
      .set({ enrich_status: status })
      .where("id", "=", leadId)
      .where("workspace_id", "=", workspaceId)
      .execute();
  }

  /**
   * Pick a sending account whose LinkedIn session performs the profile fetch.
   * Prefers an active/warming LinkedIn account; falls back to a synthetic ref
   * (the mock adapter ignores it; the real adapter needs a connected account).
   */
  private async resolveAccount(workspaceId: string): Promise<AccountRef> {
    const account = await this.db
      .selectFrom("sending_accounts")
      .select(["id"])
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "linkedin")
      .where("status", "in", ["active", "warming"])
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (account) {
      return { accountId: account.id };
    }
    return { accountId: `ws-${workspaceId}-enrichment` };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
