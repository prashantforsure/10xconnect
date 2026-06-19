import type { LeadSourceAccountRef, LeadSourceAdapter, SourcedLead } from "@10xconnect/core";
import { deriveDedupeKey } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Kysely } from "kysely";

import { KYSELY_DB } from "../../database/database.module";

import type { ConnectionsQueryDto } from "./dto";
import { LEAD_SOURCE_ADAPTER } from "./lead-source.provider";

/** A single 1st-degree connection as shown in the contacts "Connections" view. */
export interface ConnectionView {
  linkedinUrl: string | null;
  providerId: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  connectionDegree: number | null;
  /** Already imported as a lead in this workspace (so the UI can flag it). */
  alreadyContact: boolean;
}

export interface ConnectionsResult {
  connections: ConnectionView[];
  nextCursor: string | null;
  /** Whether a real LinkedIn account is connected (drives the connect-prompt). */
  accountConnected: boolean;
}

/**
 * Browse the connected account's 1st-degree connections (CLAUDE.md §8). Reads are
 * LIVE and NOT persisted — the user explicitly imports the ones they want via the
 * `profile_urls` import. Each row is annotated with `alreadyContact` so the UI can
 * flag people who are already in the workspace. Acting on connections (messaging)
 * happens through campaigns, which stay governed by the rate engine (§2).
 */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger("ConnectionsService");

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(LEAD_SOURCE_ADAPTER) private readonly leadSource: LeadSourceAdapter,
  ) {}

  async list(workspaceId: string, query: ConnectionsQueryDto): Promise<ConnectionsResult> {
    const account = await this.resolveAccount(workspaceId);
    // No real account → use a synthetic ref so the mock adapter still returns a
    // demo list locally; the real adapter will fail against it and we surface a
    // clean "not connected" state instead of a 500.
    const ref: LeadSourceAccountRef = account ?? { accountId: `ws-${workspaceId}-connections` };

    try {
      const page = await this.leadSource.fetchLeads(ref, {
        kind: "connections",
        limit: query.limit,
        cursor: query.cursor,
      });
      const connections = await this.annotate(workspaceId, page.leads);
      return {
        connections,
        nextCursor: page.nextCursor ?? null,
        accountConnected: account !== null,
      };
    } catch (err) {
      this.logger.warn(`Could not fetch connections for workspace ${workspaceId}: ${String(err)}`);
      return { connections: [], nextCursor: null, accountConnected: account !== null };
    }
  }

  /** Mark which connections already exist as leads (workspace dedupe-key match). */
  private async annotate(workspaceId: string, leads: SourcedLead[]): Promise<ConnectionView[]> {
    const keyed = leads.map((lead) => ({
      lead,
      key: deriveDedupeKey({ linkedinUrl: lead.linkedinUrl, email: lead.email }),
    }));
    const keys = [...new Set(keyed.map((k) => k.key).filter((k): k is string => Boolean(k)))];

    const existing = new Set<string>();
    if (keys.length > 0) {
      const rows = await this.db
        .selectFrom("leads")
        .select("dedupe_key")
        .where("workspace_id", "=", workspaceId)
        .where("dedupe_key", "in", keys)
        .execute();
      for (const row of rows) {
        if (row.dedupe_key) {
          existing.add(row.dedupe_key);
        }
      }
    }

    return keyed.map(({ lead, key }) => toConnectionView(lead, key ? existing.has(key) : false));
  }

  /** The workspace's connected LinkedIn account (active/warming), else null. */
  private async resolveAccount(workspaceId: string): Promise<LeadSourceAccountRef | null> {
    const account = await this.db
      .selectFrom("sending_accounts")
      .select(["id", "provider_account_id"])
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "linkedin")
      .where("status", "in", ["active", "warming"])
      .orderBy("status", "asc")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (!account) {
      return null;
    }
    return account.provider_account_id
      ? { accountId: account.id, providerAccountId: account.provider_account_id }
      : { accountId: account.id };
  }
}

function toConnectionView(lead: SourcedLead, alreadyContact: boolean): ConnectionView {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;
  return {
    linkedinUrl: lead.linkedinUrl ?? null,
    providerId: lead.providerId ?? null,
    name,
    firstName: lead.firstName ?? null,
    lastName: lead.lastName ?? null,
    headline: lead.headline ?? null,
    company: lead.company ?? null,
    location: lead.location ?? null,
    connectionDegree: lead.connectionDegree ?? null,
    alreadyContact,
  };
}
