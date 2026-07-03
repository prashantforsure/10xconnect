import type {
  LeadSourceAccountRef,
  LeadSourceAdapter,
  LeadSourceKind,
  LeadSourceQuery,
} from "@10xconnect/core";
import { parseCsvToObjects, applyMapping } from "@10xconnect/core";
import type { DB, ImportSource } from "@10xconnect/db";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { KYSELY_DB } from "../../database/database.module";

import type { ImportRequestDto } from "./dto";
import { EnrichmentService } from "./enrichment.service";
import { IMPORT_JOB_QUEUE, type ImportJobQueue } from "./import-queue";
import {
  buildLeadInsert,
  candidateDedupeKey,
  candidateFromMapped,
  candidateFromSourced,
  candidateFromUrl,
  type Candidate,
} from "./lead-mapper";
import { LEAD_SOURCE_ADAPTER } from "./lead-source.provider";

const DEFAULT_SOURCE_LIMIT = 50;
const SOURCE_PAGE_SIZE = 100;

export interface ImportJobView {
  id: string;
  source: string;
  status: string;
  listId: string | null;
  campaignId: string | null;
  params: unknown;
  totalCount: number;
  createdCount: number;
  duplicateCount: number;
  failedCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportSourceView {
  id: string;
  source: string;
  status: string;
  listId: string | null;
  campaignId: string | null;
  params: unknown;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string;
  lastJobId: string | null;
  createdAt: string;
}

interface PersistResult {
  createdLeadIds: string[];
  /** All resolved lead ids (created + matched existing), for list + enroll. */
  allLeadIds: string[];
  duplicateCount: number;
  failedCount: number;
}

/**
 * The generic import engine (Step 12/13). Every source — CSV, each LinkedIn
 * LeadSourceAdapter source, and an existing list — flows through ONE pipeline:
 * resolve candidates → workspace-dedupe → persist → link to a list → optionally
 * enroll into a campaign → trigger enrichment. Jobs are tracked in import_jobs
 * and run asynchronously via the ImportJobQueue (in-process in Phase 3).
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger("ImportService");

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(LEAD_SOURCE_ADAPTER) private readonly leadSource: LeadSourceAdapter,
    @Inject(IMPORT_JOB_QUEUE) private readonly queue: ImportJobQueue,
    private readonly enrichment: EnrichmentService,
  ) {}

  /** Create a pending import job, enqueue it, and return it immediately. */
  async startImport(
    workspaceId: string,
    userId: string | null,
    request: ImportRequestDto,
  ): Promise<ImportJobView> {
    // Validate references up front so the caller gets a clean error (not a job
    // that fails later). Heavy work happens asynchronously in runJob.
    if (request.listId) {
      await this.requireList(workspaceId, request.listId);
    }
    if (request.campaignId) {
      await this.requireCampaign(workspaceId, request.campaignId);
    }
    if (request.source === "list") {
      await this.requireList(workspaceId, request.sourceListId);
    }

    // Continuous import: pin a stable target list NOW so every re-run lands in the
    // same list, then register the recurring source after the first job is queued.
    let effective: ImportRequestDto = request;
    if (
      request.source !== "csv" &&
      request.source !== "list" &&
      request.source !== "profile_urls" &&
      request.autoRefresh &&
      !request.listId
    ) {
      const listId = await this.resolveTargetList(workspaceId, request);
      // null = skipList: leave it unpinned so each tick stays list-free too.
      if (listId) {
        effective = { ...request, listId };
      }
    }

    const job = await this.db
      .insertInto("import_jobs")
      .values({
        workspace_id: workspaceId,
        source: effective.source as ImportSource,
        status: "pending",
        list_id: effective.listId ?? null,
        campaign_id: effective.campaignId ?? null,
        params: JSON.stringify(this.describeParams(effective)),
        created_by: userId,
      })
      .returning(IMPORT_JOB_COLUMNS)
      .executeTakeFirstOrThrow();

    this.queue.enqueue(job.id, () => this.runJob(job.id, workspaceId, effective));

    if (
      effective.source !== "csv" &&
      effective.source !== "list" &&
      effective.source !== "profile_urls" &&
      effective.autoRefresh
    ) {
      await this.createImportSource(workspaceId, userId, effective, job.id);
    }
    return toJobView(job);
  }

  async listJobs(workspaceId: string): Promise<ImportJobView[]> {
    const rows = await this.db
      .selectFrom("import_jobs")
      .select(IMPORT_JOB_COLUMNS)
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();
    return rows.map(toJobView);
  }

  async getJob(workspaceId: string, jobId: string): Promise<ImportJobView> {
    const row = await this.db
      .selectFrom("import_jobs")
      .select(IMPORT_JOB_COLUMNS)
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", jobId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException("Import job not found");
    }
    return toJobView(row);
  }

  // --- continuous / auto-refresh sources ------------------------------------

  /** Register a recurring "live import" source (continuous import). */
  private async createImportSource(
    workspaceId: string,
    userId: string | null,
    request: Extract<ImportRequestDto, { source: LeadSourceKind }>,
    jobId: string,
  ): Promise<void> {
    const interval = Math.max(15, request.intervalMinutes ?? 60);
    const params = {
      url: request.url,
      keywords: request.keywords,
      filters: request.filters,
      engagement: request.engagement,
      accountId: request.accountId,
      limit: request.limit,
      tags: request.tags,
    };
    await this.db
      .insertInto("import_sources")
      .values({
        workspace_id: workspaceId,
        source: request.source as ImportSource,
        params: JSON.stringify(params),
        list_id: request.listId ?? null,
        campaign_id: request.campaignId ?? null,
        interval_minutes: interval,
        status: "active",
        next_run_at: new Date(Date.now() + interval * 60_000).toISOString(),
        last_job_id: jobId,
        created_by: userId,
      })
      .execute();
    this.logger.log(`Registered live import source (${request.source}, every ${interval}m) for ws ${workspaceId}`);
  }

  async listSources(workspaceId: string): Promise<ImportSourceView[]> {
    const rows = await this.db
      .selectFrom("import_sources")
      .select(IMPORT_SOURCE_COLUMNS)
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();
    return rows.map(toSourceView);
  }

  async pauseSource(workspaceId: string, id: string): Promise<{ status: string }> {
    await this.setSourceStatus(workspaceId, id, "paused");
    return { status: "paused" };
  }

  async resumeSource(workspaceId: string, id: string): Promise<{ status: string }> {
    const updated = await this.db
      .updateTable("import_sources")
      .set({ status: "active", next_run_at: new Date().toISOString() })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!updated) {
      throw new NotFoundException("Live import not found");
    }
    return { status: "active" };
  }

  async deleteSource(workspaceId: string, id: string): Promise<{ deleted: true }> {
    const deleted = await this.db
      .deleteFrom("import_sources")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Live import not found");
    }
    return { deleted: true };
  }

  private async setSourceStatus(
    workspaceId: string,
    id: string,
    status: "active" | "paused",
  ): Promise<void> {
    const updated = await this.db
      .updateTable("import_sources")
      .set({ status })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!updated) {
      throw new NotFoundException("Live import not found");
    }
  }

  /**
   * Run every due, active import source (called by the continuous-import poller on
   * an interval). Each tick spawns a normal import job; workspace dedupe means only
   * NEW leads persist. `next_run_at` is always advanced so a failure can't hot-loop.
   */
  async runDueSources(): Promise<number> {
    const nowIso = new Date().toISOString();
    const due = await this.db
      .selectFrom("import_sources")
      .select(IMPORT_SOURCE_COLUMNS)
      .where("status", "=", "active")
      .where("next_run_at", "<=", nowIso)
      .orderBy("next_run_at", "asc")
      .limit(10)
      .execute();

    for (const src of due) {
      const next = new Date(Date.now() + Math.max(15, src.interval_minutes) * 60_000).toISOString();
      try {
        const job = await this.startImport(src.workspace_id, src.created_by, requestFromSource(src));
        await this.db
          .updateTable("import_sources")
          .set({ last_run_at: nowIso, next_run_at: next, last_job_id: job.id })
          .where("id", "=", src.id)
          .execute();
      } catch (err) {
        this.logger.warn(`Live import ${src.id} tick failed: ${String(err)}`);
        await this.db
          .updateTable("import_sources")
          .set({ last_run_at: nowIso, next_run_at: next })
          .where("id", "=", src.id)
          .execute();
      }
    }
    return due.length;
  }

  // --- execution ------------------------------------------------------------

  /** Execute an import job end-to-end, updating status/counts as it goes. */
  async runJob(jobId: string, workspaceId: string, request: ImportRequestDto): Promise<void> {
    await this.db
      .updateTable("import_jobs")
      .set({ status: "running", started_at: new Date().toISOString() })
      .where("id", "=", jobId)
      .where("workspace_id", "=", workspaceId)
      .execute();

    try {
      const listId = await this.resolveTargetList(workspaceId, request);
      const defaultTags = request.tags ?? [];
      // The account newly-created leads are attributed to (Aimfox account-scoping).
      const owningAccountId = await this.resolveOwningAccountId(
        workspaceId,
        "accountId" in request ? request.accountId : undefined,
      );

      let result: PersistResult & { total: number };
      if (request.source === "list") {
        result = await this.importFromList(workspaceId, request.sourceListId, listId);
      } else {
        const candidates = await this.gatherCandidates(workspaceId, request);
        const persisted = await this.persistCandidates(
          workspaceId,
          candidates,
          defaultTags,
          listId,
          owningAccountId,
        );
        result = { ...persisted, total: candidates.length };
      }

      if (request.campaignId) {
        await this.enrollLeads(workspaceId, request.campaignId, result.allLeadIds);
      }

      await this.db
        .updateTable("import_jobs")
        .set({
          status: "completed",
          total_count: result.total,
          created_count: result.createdLeadIds.length,
          duplicate_count: result.duplicateCount,
          failed_count: result.failedCount,
          finished_at: new Date().toISOString(),
        })
        .where("id", "=", jobId)
        .where("workspace_id", "=", workspaceId)
        .execute();

      // Auto-enrich newly created leads (Step 14) — async, non-blocking.
      this.enrichment.scheduleEnrichment(workspaceId, result.createdLeadIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      this.logger.error(`Import job ${jobId} failed: ${message}`);
      await this.db
        .updateTable("import_jobs")
        .set({ status: "failed", error: message.slice(0, 500), finished_at: new Date().toISOString() })
        .where("id", "=", jobId)
        .where("workspace_id", "=", workspaceId)
        .execute();
    }
  }

  // --- candidate resolution -------------------------------------------------

  private async gatherCandidates(
    workspaceId: string,
    request: Exclude<ImportRequestDto, { source: "list" }>,
  ): Promise<Candidate[]> {
    if (request.source === "csv") {
      const objects = parseCsvToObjects(request.csv);
      return objects.map((row) => candidateFromMapped(applyMapping(row, request.mapping), "csv"));
    }
    if (request.source === "profile_urls") {
      return request.urls.map((url) => candidateFromUrl(url));
    }
    return this.gatherFromSource(workspaceId, request);
  }

  private async gatherFromSource(
    workspaceId: string,
    request: Extract<ImportRequestDto, { source: LeadSourceKind }>,
  ): Promise<Candidate[]> {
    const account = await this.resolveSourceAccount(workspaceId, request.accountId);
    const limit = Math.max(1, request.limit ?? DEFAULT_SOURCE_LIMIT);

    const baseQuery: LeadSourceQuery = {
      kind: request.source,
      url: request.url,
      keywords: request.keywords,
      filters: request.filters,
      engagement: request.engagement,
    };

    const collected: Candidate[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (collected.length < limit) {
      const pageSize = Math.min(SOURCE_PAGE_SIZE, limit - collected.length);
      const page = await this.leadSource.fetchLeads(account, {
        ...baseQuery,
        limit: pageSize,
        cursor,
      });
      for (const lead of page.leads) {
        collected.push(candidateFromSourced(lead, request.source));
      }
      cursor = page.nextCursor;
      guard += 1;
      if (!cursor || page.leads.length === 0 || guard > 100) {
        break;
      }
    }
    return collected.slice(0, limit);
  }

  // --- persistence + dedupe -------------------------------------------------

  /**
   * Persist candidates with workspace dedupe (CLAUDE.md §10). Leads sharing a
   * dedupe_key collapse to one row; rows already in the workspace are reused
   * (counted as duplicates). All resolved leads are linked to the target list.
   */
  private async persistCandidates(
    workspaceId: string,
    candidates: Candidate[],
    defaultTags: string[],
    listId: string | null,
    accountId: string | null,
  ): Promise<PersistResult> {
    const keyed = new Map<string, Candidate>();
    const unkeyed: Candidate[] = [];
    let duplicateCount = 0;

    for (const candidate of candidates) {
      const key = candidateDedupeKey(candidate);
      if (!key) {
        unkeyed.push(candidate);
        continue;
      }
      if (keyed.has(key)) {
        duplicateCount += 1; // same identity twice within this import
        continue;
      }
      keyed.set(key, candidate);
    }

    // Which keyed identities already exist in the workspace?
    const keys = [...keyed.keys()];
    const existingByKey = new Map<string, string>();
    if (keys.length > 0) {
      const rows = await this.db
        .selectFrom("leads")
        .select(["id", "dedupe_key"])
        .where("workspace_id", "=", workspaceId)
        .where("dedupe_key", "in", keys)
        .execute();
      for (const row of rows) {
        if (row.dedupe_key) {
          existingByKey.set(row.dedupe_key, row.id);
        }
      }
    }

    const createdLeadIds: string[] = [];
    const allLeadIds = new Set<string>();
    let failedCount = 0;

    for (const [key, candidate] of keyed) {
      const existingId = existingByKey.get(key);
      if (existingId) {
        duplicateCount += 1;
        allLeadIds.add(existingId);
        continue;
      }
      try {
        const id = await this.insertLead(workspaceId, candidate, defaultTags, key, accountId);
        createdLeadIds.push(id);
        allLeadIds.add(id);
      } catch (err) {
        // A concurrent import may have inserted the same identity first.
        const raced = await this.findByDedupeKey(workspaceId, key);
        if (raced) {
          duplicateCount += 1;
          allLeadIds.add(raced);
        } else {
          failedCount += 1;
          this.logger.warn(`Failed to insert lead (${key}): ${String(err)}`);
        }
      }
    }

    // Leads with no usable identifier can't be deduped — each is created.
    for (const candidate of unkeyed) {
      try {
        const id = await this.insertLead(workspaceId, candidate, defaultTags, undefined, accountId);
        createdLeadIds.push(id);
        allLeadIds.add(id);
      } catch (err) {
        failedCount += 1;
        this.logger.warn(`Failed to insert lead (no key): ${String(err)}`);
      }
    }

    await this.addLeadsToList(workspaceId, listId, [...allLeadIds]);
    return { createdLeadIds, allLeadIds: [...allLeadIds], duplicateCount, failedCount };
  }

  private async insertLead(
    workspaceId: string,
    candidate: Candidate,
    defaultTags: string[],
    dedupeKey: string | undefined,
    accountId: string | null,
  ): Promise<string> {
    const row = await this.db
      .insertInto("leads")
      .values(buildLeadInsert(workspaceId, candidate, defaultTags, dedupeKey, accountId))
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * The real sending-account id that newly-imported leads are attributed to.
   * Mirrors resolveSourceAccount's preference (explicit → connected → any) but
   * returns null instead of a synthetic ref, since account_id is a real FK.
   */
  private async resolveOwningAccountId(
    workspaceId: string,
    accountId: string | undefined,
  ): Promise<string | null> {
    const ref = await this.resolveSourceAccount(workspaceId, accountId);
    // resolveSourceAccount falls back to a synthetic `ws-…-source` id when the
    // workspace has no LinkedIn account — that isn't a real row, so don't store it.
    const real = await this.db
      .selectFrom("sending_accounts")
      .select("id")
      .where("id", "=", ref.accountId)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    return real?.id ?? null;
  }

  private async findByDedupeKey(workspaceId: string, key: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("leads")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("dedupe_key", "=", key)
      .executeTakeFirst();
    return row?.id;
  }

  // --- existing-list source -------------------------------------------------

  private async importFromList(
    workspaceId: string,
    sourceListId: string,
    targetListId: string | null,
  ): Promise<PersistResult & { total: number }> {
    const rows = await this.db
      .selectFrom("list_leads")
      .select("lead_id")
      .where("workspace_id", "=", workspaceId)
      .where("list_id", "=", sourceListId)
      .execute();
    const leadIds = rows.map((r) => r.lead_id);

    let createdCount = 0;
    if (targetListId !== sourceListId) {
      createdCount = await this.addLeadsToList(workspaceId, targetListId, leadIds);
    }
    return {
      total: leadIds.length,
      createdLeadIds: [], // no NEW leads — these already exist
      allLeadIds: leadIds,
      duplicateCount: leadIds.length - createdCount,
      failedCount: 0,
    };
  }

  // --- list + campaign linking ----------------------------------------------

  /** Link leads to a list (idempotent). Returns how many memberships were new. */
  private async addLeadsToList(
    workspaceId: string,
    listId: string | null,
    leadIds: string[],
  ): Promise<number> {
    if (!listId || leadIds.length === 0) {
      return 0;
    }
    const inserted = await this.db
      .insertInto("list_leads")
      .values(leadIds.map((leadId) => ({ workspace_id: workspaceId, list_id: listId, lead_id: leadId })))
      .onConflict((oc) => oc.columns(["list_id", "lead_id"]).doNothing())
      .returning("lead_id")
      .execute();
    return inserted.length;
  }

  /** Enroll leads into a campaign (idempotent; CLAUDE.md §8 POST /campaigns/:id/leads). */
  private async enrollLeads(
    workspaceId: string,
    campaignId: string,
    leadIds: string[],
  ): Promise<void> {
    if (leadIds.length === 0) {
      return;
    }
    const campaign = await this.db
      .selectFrom("campaigns")
      .select("id")
      .where("id", "=", campaignId)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    if (!campaign) {
      return; // campaign removed between request and run — skip silently
    }
    await this.db
      .insertInto("lead_campaign_state")
      .values(
        leadIds.map((leadId) => ({
          workspace_id: workspaceId,
          campaign_id: campaignId,
          lead_id: leadId,
          status: "active",
        })),
      )
      .onConflict((oc) => oc.columns(["campaign_id", "lead_id"]).doNothing())
      .execute();
  }

  // --- helpers --------------------------------------------------------------

  private async resolveTargetList(
    workspaceId: string,
    request: ImportRequestDto,
  ): Promise<string | null> {
    if (request.listId) {
      return request.listId;
    }
    // Opt-out of list creation entirely (e.g. in-campaign import): leads still
    // land in the Contacts pool + campaign, but no contact group is spawned.
    if (request.skipList && !request.listName) {
      return null;
    }
    const name = request.listName?.trim() || this.defaultListName(request);
    const created = await this.db
      .insertInto("contact_lists")
      .values({ workspace_id: workspaceId, name })
      .returning("id")
      .executeTakeFirstOrThrow();
    return created.id;
  }

  private defaultListName(request: ImportRequestDto): string {
    const date = new Date().toISOString().slice(0, 10);
    const label: Record<string, string> = {
      csv: "CSV import",
      list: "List import",
      profile_urls: "Added by URL",
      linkedin_search: "LinkedIn search",
      sales_navigator: "Sales Navigator",
      event: "Event attendees",
      post: "Post engagement",
      group: "Group members",
      lead_finder: "Lead finder",
    };
    return `${label[request.source] ?? "Import"} — ${date}`;
  }

  private async resolveSourceAccount(
    workspaceId: string,
    accountId: string | undefined,
  ): Promise<LeadSourceAccountRef> {
    // provider_account_id is the handle the real transport (Unipile) addresses;
    // the mock adapter ignores the account entirely. Threading it through is what
    // lets a real LinkedIn search run against the connected account's session.
    if (accountId) {
      const account = await this.db
        .selectFrom("sending_accounts")
        .select(["id", "provider_account_id"])
        .where("id", "=", accountId)
        .where("workspace_id", "=", workspaceId)
        .where("type", "=", "linkedin")
        .executeTakeFirst();
      if (!account) {
        throw new BadRequestException("Sending account not found in this workspace");
      }
      return toAccountRef(account);
    }
    // Prefer a connected (active/warming) LinkedIn account — sourcing through a
    // disconnected/restricted one would just fail at the provider. 'active' sorts
    // before 'warming' alphabetically, so a live account wins over a warming one.
    const healthy = await this.db
      .selectFrom("sending_accounts")
      .select(["id", "provider_account_id"])
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "linkedin")
      .where("status", "in", ["active", "warming"])
      .orderBy("status", "asc")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (healthy) {
      return toAccountRef(healthy);
    }
    const fallback = await this.db
      .selectFrom("sending_accounts")
      .select(["id", "provider_account_id"])
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "linkedin")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (fallback) {
      return toAccountRef(fallback);
    }
    return { accountId: `ws-${workspaceId}-source` };
  }

  private async requireList(workspaceId: string, listId: string): Promise<void> {
    const list = await this.db
      .selectFrom("contact_lists")
      .select("id")
      .where("id", "=", listId)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    if (!list) {
      throw new NotFoundException("List not found");
    }
  }

  private async requireCampaign(workspaceId: string, campaignId: string): Promise<void> {
    const campaign = await this.db
      .selectFrom("campaigns")
      .select("id")
      .where("id", "=", campaignId)
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
  }

  private describeParams(request: ImportRequestDto): Record<string, unknown> {
    switch (request.source) {
      case "csv":
        return { mappedColumns: Object.keys(request.mapping).length };
      case "list":
        return { sourceListId: request.sourceListId };
      case "profile_urls":
        return { count: request.urls.length };
      default:
        return {
          url: request.url,
          keywords: request.keywords,
          filters: request.filters,
          engagement: request.engagement,
          limit: request.limit,
        };
    }
  }
}

function toAccountRef(account: {
  id: string;
  provider_account_id: string | null;
}): LeadSourceAccountRef {
  return account.provider_account_id
    ? { accountId: account.id, providerAccountId: account.provider_account_id }
    : { accountId: account.id };
}

const IMPORT_JOB_COLUMNS = [
  "id",
  "source",
  "status",
  "list_id",
  "campaign_id",
  "params",
  "total_count",
  "created_count",
  "duplicate_count",
  "failed_count",
  "error",
  "started_at",
  "finished_at",
  "created_at",
  "updated_at",
] as const;

function toJobView(row: {
  id: string;
  source: string;
  status: string;
  list_id: string | null;
  campaign_id: string | null;
  params: unknown;
  total_count: number;
  created_count: number;
  duplicate_count: number;
  failed_count: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}): ImportJobView {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    listId: row.list_id,
    campaignId: row.campaign_id,
    params: row.params,
    totalCount: row.total_count,
    createdCount: row.created_count,
    duplicateCount: row.duplicate_count,
    failedCount: row.failed_count,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const IMPORT_SOURCE_COLUMNS = [
  "id",
  "workspace_id",
  "source",
  "status",
  "list_id",
  "campaign_id",
  "params",
  "interval_minutes",
  "last_run_at",
  "next_run_at",
  "last_job_id",
  "created_by",
  "created_at",
] as const;

interface ImportSourceRow {
  id: string;
  workspace_id: string;
  source: string;
  status: string;
  list_id: string | null;
  campaign_id: string | null;
  params: unknown;
  interval_minutes: number;
  last_run_at: string | null;
  next_run_at: string;
  last_job_id: string | null;
  created_by: string | null;
  created_at: string;
}

function toSourceView(row: ImportSourceRow): ImportSourceView {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    listId: row.list_id,
    campaignId: row.campaign_id,
    params: row.params,
    intervalMinutes: row.interval_minutes,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastJobId: row.last_job_id,
    createdAt: row.created_at,
  };
}

/** Rebuild an import request from a saved recurring source (no autoRefresh → no re-register). */
function requestFromSource(row: ImportSourceRow): ImportRequestDto {
  const p = (row.params ?? {}) as Record<string, unknown>;
  return {
    source: row.source,
    url: typeof p.url === "string" ? p.url : undefined,
    keywords: typeof p.keywords === "string" ? p.keywords : undefined,
    filters: p.filters,
    engagement: p.engagement,
    accountId: typeof p.accountId === "string" ? p.accountId : undefined,
    limit: typeof p.limit === "number" ? p.limit : undefined,
    listId: row.list_id ?? undefined,
    campaignId: row.campaign_id ?? undefined,
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : undefined,
  } as ImportRequestDto;
}
