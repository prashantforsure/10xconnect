import { randomUUID } from "node:crypto";

import { deriveDedupeKey, isConversationSyncCapable } from "@10xconnect/core";
import type { ChannelAdapter, ConversationThread } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser, OptionalCurrentUser } from "../auth/current-user.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

const PIPELINE_STAGES = ["new", "in_conversation", "qualified", "booked", "lost"] as const;

const CONVERSATION_FILTERS = ["all", "reply_required", "important", "mine"] as const;
type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

// "All conversations" sync only imports threads active within this window, so an
// account's ancient/personal chat history never floods the outreach inbox
// (matches HeyReach's 30-day import). Campaign-only mode ignores this.
const SYNC_WINDOW_DAYS = 30;

const updateConversationSchema = z
  .object({
    pipelineStage: z.enum(PIPELINE_STAGES).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
    snoozeUntil: z.string().datetime().nullable().optional(),
    isImportant: z.boolean().optional(),
    needsAttention: z.boolean().optional(),
    // Assign to the current user (true) or clear/assign explicitly (uuid|null).
    assignToMe: z.boolean().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
type UpdateConversationDto = z.infer<typeof updateConversationSchema>;

const replySchema = z.object({ body: z.string().trim().min(1).max(8000) });
type ReplyDto = z.infer<typeof replySchema>;

interface SyncResult {
  /** False if the configured adapter can't list conversations (e.g. email-only). */
  supported: boolean;
  /** False if no LinkedIn account is connected to sync from. */
  accountConnected: boolean;
  conversationsAdded: number;
  messagesAdded: number;
  newContacts: number;
}

const savedResponseSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(8000),
});
type SavedResponseDto = z.infer<typeof savedResponseSchema>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function leadName(enrichment: unknown, email: string | null, url: string | null): string {
  const e = asObject(enrichment);
  return (
    [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || email || url || "Lead"
  );
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: ChannelAdapter,
  ) {}

  async list(
    workspaceId: string,
    currentUserId: string | null,
    filter: ConversationFilter = "all",
    accountId?: string,
  ) {
    // Scope to CONNECTED accounts only (Aimfox/HeyReach unibox): the inner join +
    // status filter hides conversations whose owning LinkedIn profile is
    // disconnected/restricted or was switched out (previous-identity data).
    let q = this.db
      .selectFrom("conversations as c")
      .innerJoin("sending_accounts as sa", "sa.id", "c.account_id")
      .leftJoin("leads as l", "l.id", "c.lead_id")
      .select([
        "c.id as id",
        "c.lead_id as leadId",
        "c.channel as channel",
        "c.pipeline_stage as pipelineStage",
        "c.snooze_until as snoozeUntil",
        "c.tags as tags",
        "c.needs_attention as needsAttention",
        "c.is_important as isImportant",
        "c.assigned_to as assignedTo",
        "c.updated_at as updatedAt",
        "l.enrichment as enrichment",
        "l.email as email",
        "l.linkedin_url as linkedinUrl",
        "sa.id as accountId",
        "sa.name as accountName",
        "sa.label as accountLabel",
        "sa.avatar_url as accountAvatarUrl",
      ])
      .where("c.workspace_id", "=", workspaceId)
      .where("sa.status", "in", ["active", "warming"])
      .orderBy("c.updated_at", "desc");
    // Inbox label filters (the human cockpit). "all" applies no extra predicate.
    if (filter === "reply_required") {
      q = q.where("c.needs_attention", "=", true);
    } else if (filter === "important") {
      q = q.where("c.is_important", "=", true);
    } else if (filter === "mine") {
      if (!currentUserId) {
        return []; // "mine" is meaningless for API-key requests (no user)
      }
      q = q.where("c.assigned_to", "=", currentUserId);
    }
    if (accountId) {
      q = q.where("sa.id", "=", accountId);
    }
    const rows = await q.execute();

    // Attach the latest message preview per conversation.
    const ids = rows.map((r) => r.id);
    const lastByConvo = await this.lastMessages(ids);
    return rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      leadName: leadName(r.enrichment, r.email, r.linkedinUrl),
      channel: r.channel,
      pipelineStage: r.pipelineStage,
      snoozeUntil: r.snoozeUntil,
      tags: r.tags,
      needsAttention: r.needsAttention,
      isImportant: r.isImportant,
      assignedToMe: currentUserId !== null && r.assignedTo === currentUserId,
      updatedAt: r.updatedAt,
      lastMessage: lastByConvo.get(r.id) ?? null,
      account: {
        id: r.accountId,
        name: r.accountLabel ?? r.accountName,
        avatarUrl: r.accountAvatarUrl,
      },
    }));
  }

  private async lastMessages(conversationIds: string[]) {
    const map = new Map<string, { body: string | null; direction: string; at: string }>();
    if (conversationIds.length === 0) {
      return map;
    }
    const rows = await this.db
      .selectFrom("messages")
      .select(["conversation_id", "body", "direction", "created_at"])
      .where("conversation_id", "in", conversationIds)
      .orderBy("created_at", "desc")
      .execute();
    for (const m of rows) {
      if (!map.has(m.conversation_id)) {
        map.set(m.conversation_id, { body: m.body, direction: m.direction, at: m.created_at });
      }
    }
    return map;
  }

  /**
   * Sync existing conversations from the connected account into the inbox
   * (CLAUDE.md §8/§9 "extract all conversations"). Pulls threads via the adapter's
   * ConversationSyncCapable capability, resolves/creates the lead each thread
   * belongs to, then upserts the conversation + its messages. Idempotent: a
   * conversation that already exists is left as-is (re-sync adds no duplicates).
   * Respects inbox_type — campaign_only syncs only threads with an enrolled lead.
   */
  async sync(workspaceId: string): Promise<SyncResult> {
    const empty: SyncResult = {
      supported: true,
      accountConnected: false,
      conversationsAdded: 0,
      messagesAdded: 0,
      newContacts: 0,
    };
    if (!isConversationSyncCapable(this.adapter)) {
      return { ...empty, supported: false };
    }
    // Multi-account unibox (§6 agency surface): sync EVERY connected LinkedIn account,
    // not just one. Each account owns its own threads; syncThread stamps the owning
    // account on the conversation so the inbox can filter/attribute per sender.
    const accounts = await this.db
      .selectFrom("sending_accounts")
      .select(["id", "provider_account_id"])
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "linkedin")
      .where("status", "in", ["active", "warming"])
      .orderBy("status", "asc")
      .orderBy("created_at", "asc")
      .execute();
    if (accounts.length === 0) {
      return empty;
    }

    const ws = await this.db
      .selectFrom("workspaces")
      .select("settings")
      .where("id", "=", workspaceId)
      .executeTakeFirst();
    const campaignOnly = asObject(ws?.settings).inbox_type === "campaign_only";

    // HeyReach model: in "all conversations" mode only import threads active in the
    // last 30 days (never the whole history — that pulls old/personal chats). In
    // campaign-only mode, thread age doesn't matter (enrolled leads only).
    const recentSinceIso = new Date(Date.now() - SYNC_WINDOW_DAYS * 86_400_000).toISOString();

    const result: SyncResult = { ...empty, accountConnected: true };
    for (const account of accounts) {
      const page = await this.adapter.listConversations(
        { accountId: account.id, providerAccountId: account.provider_account_id ?? undefined },
        { limit: 30 },
      );
      for (const thread of page.threads) {
        const r = await this.syncThread(workspaceId, account.id, thread, campaignOnly, recentSinceIso);
        if (r.conversationCreated) result.conversationsAdded += 1;
        if (r.leadCreated) result.newContacts += 1;
        result.messagesAdded += r.messagesAdded;
      }
    }
    return result;
  }

  private async syncThread(
    workspaceId: string,
    accountId: string,
    thread: ConversationThread,
    campaignOnly: boolean,
    recentSinceIso: string,
  ): Promise<{ conversationCreated: boolean; messagesAdded: number; leadCreated: boolean }> {
    const noop = { conversationCreated: false, messagesAdded: 0, leadCreated: false };
    const { attendee, messages } = thread;
    if (messages.length === 0) {
      return noop;
    }

    const lastAt = messages.reduce((max, m) => (m.sentAt > max ? m.sentAt : max), messages[0].sentAt);

    // Resolve the lead this thread belongs to (by dedupe key, then by URL).
    const dedupeKey = deriveDedupeKey({ linkedinUrl: attendee.linkedinUrl });
    let leadId = await this.findLeadId(workspaceId, dedupeKey, attendee.linkedinUrl);
    let leadCreated = false;

    if (campaignOnly) {
      if (!leadId || !(await this.isEnrolled(workspaceId, leadId))) {
        return noop; // campaign-only inbox: skip non-campaign threads
      }
    } else if (lastAt < recentSinceIso) {
      // "All conversations" mode: skip threads with no recent activity so old /
      // personal chats never flood the outreach inbox (HeyReach 30-day window).
      return noop;
    }

    if (!leadId) {
      if (!attendee.linkedinUrl && !attendee.providerId) {
        return noop; // nothing to anchor a contact to
      }
      leadId = await this.createLeadFromAttendee(workspaceId, accountId, attendee, dedupeKey);
      leadCreated = true;
    }

    // Upsert conversation (idempotent by workspace + lead + channel).
    const existing = await this.db
      .selectFrom("conversations")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("lead_id", "=", leadId)
      .where("channel", "=", thread.channel)
      .executeTakeFirst();
    if (existing) {
      return { conversationCreated: false, messagesAdded: 0, leadCreated };
    }

    const hasInbound = messages.some((m) => m.direction === "inbound");
    const convo = await this.db
      .insertInto("conversations")
      .values({
        workspace_id: workspaceId,
        account_id: accountId,
        lead_id: leadId,
        channel: thread.channel,
        pipeline_stage: hasInbound ? "in_conversation" : "new",
        updated_at: lastAt,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto("messages")
      .values(
        messages.map((m) => ({
          workspace_id: workspaceId,
          conversation_id: convo.id,
          direction: m.direction,
          channel: m.channel,
          body: m.body ?? null,
          voice_ref: m.voiceRef ?? null,
          created_at: m.sentAt, // preserve provider chronology
        })),
      )
      .execute();

    return { conversationCreated: true, messagesAdded: messages.length, leadCreated };
  }

  private async findLeadId(
    workspaceId: string,
    dedupeKey: string | undefined,
    linkedinUrl: string | undefined,
  ): Promise<string | null> {
    if (dedupeKey) {
      const row = await this.db
        .selectFrom("leads")
        .select("id")
        .where("workspace_id", "=", workspaceId)
        .where("dedupe_key", "=", dedupeKey)
        .executeTakeFirst();
      if (row) return row.id;
    }
    if (linkedinUrl) {
      const row = await this.db
        .selectFrom("leads")
        .select("id")
        .where("workspace_id", "=", workspaceId)
        .where("linkedin_url", "=", linkedinUrl)
        .executeTakeFirst();
      if (row) return row.id;
    }
    return null;
  }

  private async isEnrolled(workspaceId: string, leadId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("lead_campaign_state")
      .select("lead_id")
      .where("workspace_id", "=", workspaceId)
      .where("lead_id", "=", leadId)
      .executeTakeFirst();
    return Boolean(row);
  }

  private async createLeadFromAttendee(
    workspaceId: string,
    accountId: string,
    attendee: ConversationThread["attendee"],
    dedupeKey: string | undefined,
  ): Promise<string> {
    const [firstName, ...rest] = (attendee.name ?? "").trim().split(/\s+/).filter(Boolean);
    const enrichment: Record<string, unknown> = { source: "conversation_sync" };
    if (firstName) enrichment.firstName = firstName;
    if (rest.length) enrichment.lastName = rest.join(" ");
    if (attendee.headline) enrichment.headline = attendee.headline;
    if (attendee.connectionDegree) enrichment.connectionDegree = attendee.connectionDegree;
    if (attendee.providerId) enrichment.providerId = attendee.providerId;

    const row = await this.db
      .insertInto("leads")
      .values({
        workspace_id: workspaceId,
        account_id: accountId,
        linkedin_url: attendee.linkedinUrl ?? null,
        email: null,
        enrichment: JSON.stringify(enrichment),
        tags: [],
        custom_columns: JSON.stringify({}),
        dedupe_key: dedupeKey ?? null,
        connection_degree: attendee.connectionDegree ?? null,
        enrich_status: "enriched",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async detail(workspaceId: string, id: string, currentUserId: string | null) {
    const c = await this.db
      .selectFrom("conversations as c")
      .leftJoin("leads as l", "l.id", "c.lead_id")
      .select([
        "c.id as id",
        "c.lead_id as leadId",
        "c.account_id as accountId",
        "c.channel as channel",
        "c.pipeline_stage as pipelineStage",
        "c.snooze_until as snoozeUntil",
        "c.tags as tags",
        "c.needs_attention as needsAttention",
        "c.is_important as isImportant",
        "c.assigned_to as assignedTo",
        "l.enrichment as enrichment",
        "l.email as email",
        "l.linkedin_url as linkedinUrl",
        "l.tags as leadTags",
      ])
      .where("c.workspace_id", "=", workspaceId)
      .where("c.id", "=", id)
      .executeTakeFirst();
    if (!c) {
      throw new NotFoundException("Conversation not found");
    }
    const messages = await this.db
      .selectFrom("messages")
      .select(["id", "direction", "channel", "body", "voice_ref as voiceRef", "authored_by as authoredBy", "created_at as at"])
      .where("conversation_id", "=", id)
      .orderBy("created_at", "asc")
      .execute();

    // The latest AI suggestion awaiting a human (pending draft or escalation).
    const draftRow = await this.db
      .selectFrom("message_drafts")
      .select(["id", "status", "body", "confidence", "reasoning"])
      .where("conversation_id", "=", id)
      .where("status", "in", ["pending", "escalated"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    const draft = draftRow
      ? {
          id: draftRow.id,
          status: draftRow.status,
          body: draftRow.body,
          confidence: draftRow.confidence,
          reason: (asObject(draftRow.reasoning).reason as string | undefined) ?? null,
          action: (asObject(draftRow.reasoning).action as string | undefined) ?? null,
          // Hot-lead handoff briefing (Phase 4), when present.
          summary: (asObject(draftRow.reasoning).summary as string | undefined) ?? null,
          nextStep: (asObject(draftRow.reasoning).nextStep as string | undefined) ?? null,
        }
      : null;

    // Relationship axis (Phase 1/4) — stage + hot-lead summary for the cockpit.
    const relRow = c.leadId
      ? await this.db
          .selectFrom("relationship_state")
          .select(["stage", "intent_score as intentScore", "summary", "next_action as nextAction", "do_not_reply as doNotReply", "campaign_id as campaignId"])
          .where("lead_id", "=", c.leadId)
          .executeTakeFirst()
      : undefined;
    // The AI reply mode of the campaign this conversation belongs to (drives the
    // inbox copy: Manual drafts-for-approval vs Balanced/Autopilot auto-send).
    const brainRow = relRow?.campaignId
      ? await this.db
          .selectFrom("campaigns")
          .select(["autonomy", "objective", "knowledge_base_id as knowledgeBaseId"])
          .where("id", "=", relRow.campaignId)
          .executeTakeFirst()
      : undefined;
    const aiMode =
      (asObject(brainRow?.autonomy).mode as string | undefined) ?? null;
    const hasBrain = Boolean(brainRow?.objective || brainRow?.knowledgeBaseId);
    const relationship = relRow
      ? {
          stage: relRow.stage,
          intentScore: relRow.intentScore,
          summary: relRow.summary,
          nextAction: relRow.nextAction,
          aiPaused: relRow.doNotReply,
          isHot: relRow.stage === "hot_lead",
          aiMode,
          hasBrain,
        }
      : null;

    const e = asObject(c.enrichment);
    return {
      id: c.id,
      leadId: c.leadId,
      channel: c.channel,
      pipelineStage: c.pipelineStage,
      snoozeUntil: c.snoozeUntil,
      tags: c.tags,
      needsAttention: c.needsAttention,
      isImportant: c.isImportant,
      assignedToMe: currentUserId !== null && c.assignedTo === currentUserId,
      draft,
      relationship,
      lead: {
        name: leadName(c.enrichment, c.email, c.linkedinUrl),
        headline: typeof e.headline === "string" ? e.headline : null,
        company: typeof e.company === "string" ? e.company : null,
        role: typeof e.role === "string" ? e.role : null,
        linkedinUrl: c.linkedinUrl,
        email: c.email,
        tags: c.leadTags ?? [],
      },
      messages,
    };
  }

  /**
   * Enqueue a manual reply as a node-less `conversation_reply` action. It is NOT
   * sent here — the dispatch worker picks it up and sends it through the safety
   * spine (adapter + idempotency), exactly the path future AI replies reuse.
   * Never calls a transport provider directly.
   */
  async reply(workspaceId: string, id: string, dto: ReplyDto) {
    const c = await this.db
      .selectFrom("conversations as c")
      .leftJoin("sending_accounts as sa", "sa.id", "c.account_id")
      .select([
        "c.id as id",
        "c.channel as channel",
        "c.lead_id as leadId",
        "c.account_id as accountId",
        "sa.status as accountStatus",
      ])
      .where("c.workspace_id", "=", workspaceId)
      .where("c.id", "=", id)
      .executeTakeFirst();
    if (!c) {
      throw new NotFoundException("Conversation not found");
    }
    if (!c.accountId) {
      throw new BadGatewayException("This conversation has no sending account.");
    }
    // Don't queue a send on a profile that isn't connected (disconnected/restricted/
    // paused, or switched out). The reply would just fail at the provider.
    if (c.accountStatus !== "active" && c.accountStatus !== "warming") {
      throw new BadGatewayException(
        "The LinkedIn account for this conversation isn't connected. Reconnect it to reply.",
      );
    }

    const idempotencyKey = `reply:${id}:${randomUUID()}`;
    await this.db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: c.accountId,
        lead_id: c.leadId,
        type: "message",
        status: "pending",
        idempotency_key: idempotencyKey,
        scheduled_at: new Date().toISOString(),
        config: JSON.stringify({
          kind: "conversation_reply",
          conversationId: id,
          body: dto.body,
          channel: c.channel,
        }),
      })
      .execute();
    // Surface the thread to the top of the human pipeline.
    await this.db
      .updateTable("conversations")
      .set({ pipeline_stage: "in_conversation" })
      .where("id", "=", id)
      .where("pipeline_stage", "=", "new")
      .execute();

    return { queued: true };
  }

  async update(
    workspaceId: string,
    id: string,
    currentUserId: string | null,
    dto: UpdateConversationDto,
  ) {
    if (dto.assignToMe && !currentUserId) {
      throw new BadRequestException("assignToMe requires a user session (not an API key)");
    }
    const updated = await this.db
      .updateTable("conversations")
      .set({
        ...(dto.pipelineStage ? { pipeline_stage: dto.pipelineStage } : {}),
        ...(dto.tags ? { tags: dto.tags } : {}),
        ...(dto.snoozeUntil !== undefined ? { snooze_until: dto.snoozeUntil } : {}),
        ...(dto.isImportant !== undefined ? { is_important: dto.isImportant } : {}),
        ...(dto.needsAttention !== undefined ? { needs_attention: dto.needsAttention } : {}),
        // assignToMe wins if both are sent; assignedTo can explicitly clear (null).
        ...(dto.assignToMe && currentUserId ? { assigned_to: currentUserId } : {}),
        ...(dto.assignedTo !== undefined ? { assigned_to: dto.assignedTo } : {}),
      })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning([
        "id",
        "pipeline_stage as pipelineStage",
        "tags",
        "snooze_until as snoozeUntil",
        "needs_attention as needsAttention",
        "is_important as isImportant",
        "assigned_to as assignedTo",
      ])
      .executeTakeFirst();
    if (!updated) {
      throw new NotFoundException("Conversation not found");
    }
    return {
      ...updated,
      assignedToMe: currentUserId !== null && updated.assignedTo === currentUserId,
    };
  }

  listSavedResponses(workspaceId: string) {
    return this.db
      .selectFrom("saved_responses")
      .select(["id", "title", "body"])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
  }

  createSavedResponse(workspaceId: string, userId: string, dto: SavedResponseDto) {
    return this.db
      .insertInto("saved_responses")
      .values({ workspace_id: workspaceId, title: dto.title, body: dto.body, created_by: userId })
      .returning(["id", "title", "body"])
      .executeTakeFirstOrThrow();
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get("conversations")
  list(
    @WorkspaceId() workspaceId: string,
    @OptionalCurrentUser() user: AuthUser | undefined,
    @Query("filter") filter?: string,
    @Query("accountId") accountId?: string,
  ) {
    const f = (CONVERSATION_FILTERS as readonly string[]).includes(filter ?? "")
      ? (filter as ConversationFilter)
      : "all";
    return this.conversations.list(workspaceId, user?.id ?? null, f, accountId || undefined);
  }

  @Post("conversations/sync")
  sync(@WorkspaceId() workspaceId: string) {
    return this.conversations.sync(workspaceId);
  }

  @Get("conversations/:id")
  detail(
    @WorkspaceId() workspaceId: string,
    @OptionalCurrentUser() user: AuthUser | undefined,
    @Param("id") id: string,
  ) {
    return this.conversations.detail(workspaceId, id, user?.id ?? null);
  }

  @Post("conversations/:id/reply")
  reply(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replySchema)) body: ReplyDto,
  ) {
    return this.conversations.reply(workspaceId, id, body);
  }

  @Patch("conversations/:id")
  update(
    @WorkspaceId() workspaceId: string,
    @OptionalCurrentUser() user: AuthUser | undefined,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateConversationSchema)) body: UpdateConversationDto,
  ) {
    return this.conversations.update(workspaceId, id, user?.id ?? null, body);
  }

  @Get("saved-responses")
  listSavedResponses(@WorkspaceId() workspaceId: string) {
    return this.conversations.listSavedResponses(workspaceId);
  }

  @Post("saved-responses")
  createSavedResponse(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(savedResponseSchema)) body: SavedResponseDto,
  ) {
    return this.conversations.createSavedResponse(workspaceId, user.id, body);
  }
}

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
