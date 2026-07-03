import { deriveDedupeKey, serializeCsv } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { addToDoNotContact } from "@10xconnect/engine";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql } from "kysely";

import { KYSELY_DB } from "../../database/database.module";

import type { BulkActionDto, ExportLeadsDto, ListLeadsQueryDto, UpdateLeadDto } from "./dto";
import { asEnrichment, type LeadView, toLeadView } from "./lead-mapper";

/** The filter fields shared by list() and exportCsv() (drives buildConditions). */
type LeadFilter = Pick<ListLeadsQueryDto, "search" | "listId" | "tag" | "enrichStatus">;

const LEAD_COLUMNS = [
  "id",
  "workspace_id",
  "linkedin_url",
  "email",
  "enrichment",
  "tags",
  "custom_columns",
  "dedupe_key",
  "enrich_status",
  "connection_degree",
  "note",
  "account_id",
  "created_at",
  "updated_at",
] as const;

export interface LeadListResult {
  leads: LeadView[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeadCampaignMembership {
  id: string;
  name: string;
  status: string;
  /** The lead's own state within this campaign (active|completed|replied|…). */
  leadStatus: string;
  currentNodeId: string | null;
}

export interface LeadDetail extends LeadView {
  lists: { id: string; name: string; color: string | null }[];
  campaigns: LeadCampaignMembership[];
  /** Long-form enrichment surfaced only in the detail drawer (not the list view). */
  enrichment: {
    about?: string;
    recentPosts?: { postId: string; url?: string; text?: string; postedAt?: string }[];
  };
}

/** One entry in a lead's cross-campaign activity timeline. */
export interface LeadActivityItem {
  kind: "action" | "message";
  /** action type (e.g. send_message) or message direction (inbound|outbound). */
  label: string;
  status: string | null;
  body: string | null;
  channel: string | null;
  campaignId: string | null;
  at: string;
}

@Injectable()
export class LeadsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async list(workspaceId: string, query: ListLeadsQueryDto): Promise<LeadListResult> {
    const conditions = this.buildConditions(workspaceId, query);

    const rows = await this.db
      .selectFrom("leads")
      .select(LEAD_COLUMNS)
      .where((eb) => eb.and(conditions(eb)))
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    const { total } = await this.db
      .selectFrom("leads")
      .where((eb) => eb.and(conditions(eb)))
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    return {
      leads: rows.map(toLeadView),
      total: Number(total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  /**
   * Export leads matching the same filters as list() to CSV text. Formula-
   * injection-safe (serializeCsv). Capped so an export can't exhaust memory;
   * `selectedIds` narrows to an explicit selection (the "export selected" path).
   */
  async exportCsv(workspaceId: string, filter: ExportLeadsDto): Promise<string> {
    const EXPORT_CAP = 10_000;
    const conditions = this.buildConditions(workspaceId, filter);

    let q = this.db
      .selectFrom("leads")
      .select(LEAD_COLUMNS)
      .where((eb) => eb.and(conditions(eb)));
    if (filter.selectedIds && filter.selectedIds.length > 0) {
      q = q.where("id", "in", filter.selectedIds);
    }
    const rows = await q.orderBy("created_at", "desc").limit(EXPORT_CAP).execute();

    const headers = [
      "Name",
      "First name",
      "Last name",
      "Email",
      "LinkedIn URL",
      "Headline",
      "Company",
      "Role",
      "Location",
      "Connection degree",
      "Tags",
      "Enrich status",
      "Note",
      "Created at",
    ];
    const body = rows.map(toLeadView).map((l) => [
      l.name,
      l.firstName,
      l.lastName,
      l.email,
      l.linkedinUrl,
      l.headline,
      l.company,
      l.role,
      l.location,
      l.connectionDegree,
      l.tags.join(", "),
      l.enrichStatus,
      l.note,
      l.createdAt,
    ]);
    return serializeCsv(headers, body);
  }

  async get(workspaceId: string, id: string): Promise<LeadDetail> {
    const row = await this.db
      .selectFrom("leads")
      .select(LEAD_COLUMNS)
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException("Lead not found");
    }
    const enrichment = asEnrichment(row.enrichment);

    const lists = await this.db
      .selectFrom("list_leads")
      .innerJoin("contact_lists", "contact_lists.id", "list_leads.list_id")
      .where("list_leads.workspace_id", "=", workspaceId)
      .where("contact_lists.workspace_id", "=", workspaceId)
      .where("list_leads.lead_id", "=", id)
      .select(["contact_lists.id as id", "contact_lists.name as name", "contact_lists.color as color"])
      .execute();

    const campaigns = await this.db
      .selectFrom("lead_campaign_state")
      .innerJoin("campaigns", "campaigns.id", "lead_campaign_state.campaign_id")
      .where("lead_campaign_state.workspace_id", "=", workspaceId)
      .where("campaigns.workspace_id", "=", workspaceId)
      .where("lead_campaign_state.lead_id", "=", id)
      .select([
        "campaigns.id as id",
        "campaigns.name as name",
        "campaigns.status as status",
        "lead_campaign_state.status as leadStatus",
        "lead_campaign_state.current_node_id as currentNodeId",
      ])
      .execute();

    return {
      ...toLeadView(row),
      lists,
      campaigns,
      enrichment: {
        ...(enrichment.about ? { about: enrichment.about } : {}),
        ...(enrichment.recentPosts ? { recentPosts: enrichment.recentPosts } : {}),
      },
    };
  }

  /**
   * A lead's cross-campaign activity timeline: executed/queued outreach actions
   * plus inbound/outbound conversation messages, newest first. All workspace-
   * scoped. Read-only; drives the Contacts detail-drawer timeline (CLAUDE.md §9).
   */
  async activity(workspaceId: string, id: string, limit = 50): Promise<LeadActivityItem[]> {
    // Confirm the lead exists in this workspace (also a 404 guard for IDOR).
    const lead = await this.db
      .selectFrom("leads")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!lead) {
      throw new NotFoundException("Lead not found");
    }

    const actions = await this.db
      .selectFrom("actions")
      .select(["type", "status", "campaign_id", "executed_at", "scheduled_at", "created_at"])
      .where("workspace_id", "=", workspaceId)
      .where("lead_id", "=", id)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();

    const messages = await this.db
      .selectFrom("messages")
      .innerJoin("conversations", "conversations.id", "messages.conversation_id")
      .select([
        "messages.direction as direction",
        "messages.body as body",
        "messages.channel as channel",
        "messages.created_at as created_at",
      ])
      .where("messages.workspace_id", "=", workspaceId)
      .where("conversations.lead_id", "=", id)
      .orderBy("messages.created_at", "desc")
      .limit(limit)
      .execute();

    const items: LeadActivityItem[] = [
      ...actions.map((a) => ({
        kind: "action" as const,
        label: a.type,
        status: a.status,
        body: null,
        channel: null,
        campaignId: a.campaign_id,
        at: a.executed_at ?? a.scheduled_at ?? a.created_at,
      })),
      ...messages.map((m) => ({
        kind: "message" as const,
        label: m.direction,
        status: null,
        body: m.body,
        channel: m.channel,
        campaignId: null,
        at: m.created_at,
      })),
    ];
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return items.slice(0, limit);
  }

  async update(workspaceId: string, id: string, dto: UpdateLeadDto): Promise<LeadView> {
    const current = await this.db
      .selectFrom("leads")
      .select(["id", "linkedin_url", "email", "enrichment"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!current) {
      throw new NotFoundException("Lead not found");
    }

    const set: Record<string, unknown> = {};
    let nextLinkedin = current.linkedin_url;
    let nextEmail = current.email;

    if (dto.linkedinUrl !== undefined) {
      nextLinkedin = dto.linkedinUrl;
      set.linkedin_url = dto.linkedinUrl;
    }
    if (dto.email !== undefined) {
      nextEmail = dto.email ? dto.email.toLowerCase() : null;
      set.email = nextEmail;
    }
    if (dto.linkedinUrl !== undefined || dto.email !== undefined) {
      set.dedupe_key = deriveDedupeKey({ linkedinUrl: nextLinkedin, email: nextEmail }) ?? null;
    }
    if (dto.tags !== undefined) {
      set.tags = Array.from(new Set(dto.tags));
    }
    if (dto.customColumns !== undefined) {
      set.custom_columns = JSON.stringify(dto.customColumns);
    }
    if (dto.note !== undefined) {
      const trimmed = dto.note?.trim();
      set.note = trimmed ? trimmed : null;
    }
    if (dto.fields !== undefined) {
      const merged = { ...asEnrichment(current.enrichment), ...stripUndefined(dto.fields) };
      set.enrichment = JSON.stringify(merged);
    }

    try {
      const updated = await this.db
        .updateTable("leads")
        .set(set)
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", id)
        .returning(LEAD_COLUMNS)
        .executeTakeFirstOrThrow();
      return toLeadView(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("Another lead already has this LinkedIn URL or email");
      }
      throw err;
    }
  }

  async remove(workspaceId: string, id: string): Promise<{ deleted: true; id: string }> {
    const deleted = await this.db
      .deleteFrom("leads")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Lead not found");
    }
    return { deleted: true, id };
  }

  /** Multi-select bulk actions from the contacts UI. All scoped by workspace. */
  async bulk(workspaceId: string, dto: BulkActionDto): Promise<{ affected: number }> {
    const ids = dto.leadIds;
    switch (dto.action) {
      case "add_tags": {
        const result = await this.db
          .updateTable("leads")
          .set({
            tags: sql`array(select distinct e from unnest(tags || ${sql.val(dto.tags)}::text[]) as e)`,
          })
          .where("workspace_id", "=", workspaceId)
          .where("id", "in", ids)
          .executeTakeFirst();
        return { affected: Number(result.numUpdatedRows) };
      }
      case "remove_tags": {
        const result = await this.db
          .updateTable("leads")
          .set({
            tags: sql`array(select e from unnest(tags) as e where e <> all(${sql.val(dto.tags)}::text[]))`,
          })
          .where("workspace_id", "=", workspaceId)
          .where("id", "in", ids)
          .executeTakeFirst();
        return { affected: Number(result.numUpdatedRows) };
      }
      case "add_to_list": {
        await this.requireList(workspaceId, dto.listId);
        const inserted = await this.db
          .insertInto("list_leads")
          .values(ids.map((leadId) => ({ workspace_id: workspaceId, list_id: dto.listId, lead_id: leadId })))
          .onConflict((oc) => oc.columns(["list_id", "lead_id"]).doNothing())
          .returning("lead_id")
          .execute();
        return { affected: inserted.length };
      }
      case "remove_from_list": {
        const result = await this.db
          .deleteFrom("list_leads")
          .where("workspace_id", "=", workspaceId)
          .where("list_id", "=", dto.listId)
          .where("lead_id", "in", ids)
          .executeTakeFirst();
        return { affected: Number(result.numDeletedRows) };
      }
      case "enroll_campaign": {
        await this.requireCampaign(workspaceId, dto.campaignId);
        const inserted = await this.db
          .insertInto("lead_campaign_state")
          .values(
            ids.map((leadId) => ({
              workspace_id: workspaceId,
              campaign_id: dto.campaignId,
              lead_id: leadId,
              status: "active",
            })),
          )
          .onConflict((oc) => oc.columns(["campaign_id", "lead_id"]).doNothing())
          .returning("id")
          .execute();
        return { affected: inserted.length };
      }
      case "mark_do_not_contact": {
        // Suppress every selected lead's identifiers so NO campaign contacts them
        // again (enforced at enrollment + send by the engine). Idempotent.
        const rows = await this.db
          .selectFrom("leads")
          .select(["linkedin_url", "email"])
          .where("workspace_id", "=", workspaceId)
          .where("id", "in", ids)
          .execute();
        let affected = 0;
        for (const row of rows) {
          if (!row.linkedin_url && !row.email) {
            continue;
          }
          await addToDoNotContact(
            this.db,
            workspaceId,
            { linkedin_url: row.linkedin_url, email: row.email },
            dto.reason ?? "manual",
          );
          affected += 1;
        }
        return { affected };
      }
      case "delete": {
        const result = await this.db
          .deleteFrom("leads")
          .where("workspace_id", "=", workspaceId)
          .where("id", "in", ids)
          .executeTakeFirst();
        return { affected: Number(result.numDeletedRows) };
      }
    }
  }

  // --- helpers --------------------------------------------------------------

  private buildConditions(workspaceId: string, query: LeadFilter) {
    return (eb: ExpressionBuilder<DB, "leads">): Expression<SqlBool>[] => {
      const conds: Expression<SqlBool>[] = [eb("workspace_id", "=", workspaceId)];

      if (query.search) {
        const term = `%${query.search}%`;
        conds.push(
          eb.or([
            eb("email", "ilike", term),
            eb("linkedin_url", "ilike", term),
            sql<SqlBool>`${eb.ref("enrichment")}::text ilike ${term}`,
          ]),
        );
      }
      if (query.enrichStatus) {
        conds.push(eb("enrich_status", "=", query.enrichStatus));
      }
      if (query.tag) {
        conds.push(sql<SqlBool>`${eb.ref("tags")} @> ARRAY[${sql.val(query.tag)}]::text[]`);
      }
      if (query.listId) {
        conds.push(
          eb(
            "id",
            "in",
            eb
              .selectFrom("list_leads")
              .innerJoin("contact_lists", "contact_lists.id", "list_leads.list_id")
              .select("list_leads.lead_id")
              .where("list_leads.workspace_id", "=", workspaceId)
              .where("contact_lists.workspace_id", "=", workspaceId)
              .where("list_leads.list_id", "=", query.listId),
          ),
        );
      }
      return conds;
    };
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
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
