import { ageDaysSince, computeHealth, effectiveCaps } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { computeUnitEconomics } from "@10xconnect/engine";
import { Controller, Get, Inject, Injectable, Module, Param, Query, UseGuards } from "@nestjs/common";
import { type Kysely, sql } from "kysely";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { KYSELY_DB } from "../database/database.module";

const ENGAGEMENT_TYPES = [
  "like_post",
  "comment_post",
  "reply_comment",
  "visit_profile",
  "follow_lead",
  "open_profile_message",
];

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function leadName(enrichment: unknown, email: string | null, url: string | null): string {
  const e = asObject(enrichment);
  return [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || email || url || "Lead";
}
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

export type AnalyticsRange = "7d" | "30d" | "all";
export function parseAnalyticsRange(value: string | undefined): AnalyticsRange {
  return value === "7d" || value === "30d" ? value : "all";
}

/**
 * Resolve a range into the current window plus the immediately-preceding window
 * of equal length (used for period-over-period deltas). "all" has no window.
 */
function rangeWindow(range: AnalyticsRange): {
  since: Date | null;
  prevSince: Date | null;
  prevUntil: Date | null;
} {
  if (range === "all") {
    return { since: null, prevSince: null, prevUntil: null };
  }
  const ms = (range === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const since = new Date(now - ms);
  return { since, prevSince: new Date(now - 2 * ms), prevUntil: since };
}

/** Percentage change vs a prior period; null when there's no comparable base. */
function delta(curr: number, prev: number): number | null {
  return prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /** Successful action counts grouped by type, optionally scoped to a campaign + time window. */
  private async actionCounts(
    workspaceId: string,
    opts: { campaignId?: string; since?: Date | null; until?: Date | null } = {},
  ): Promise<Record<string, number>> {
    let q = this.db
      .selectFrom("actions")
      .select((eb) => ["type", eb.fn.countAll<string>().as("count")])
      .where("workspace_id", "=", workspaceId)
      .where("status", "=", "success");
    if (opts.campaignId) {
      q = q.where("campaign_id", "=", opts.campaignId);
    }
    if (opts.since) {
      q = q.where("executed_at", ">=", opts.since.toISOString());
    }
    if (opts.until) {
      q = q.where("executed_at", "<", opts.until.toISOString());
    }
    const rows = await q.groupBy("type").execute();
    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.type] = Number(r.count);
    }
    return map;
  }

  private async countLeadEvents(
    workspaceId: string,
    type: string,
    since?: Date | null,
    until?: Date | null,
  ): Promise<number> {
    let q = this.db
      .selectFrom("lead_events")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", type);
    if (since) {
      q = q.where("occurred_at", ">=", since.toISOString());
    }
    if (until) {
      q = q.where("occurred_at", "<", until.toISOString());
    }
    const { count } = await q.executeTakeFirstOrThrow();
    return Number(count);
  }

  private async countConversations(
    workspaceId: string,
    since?: Date | null,
    until?: Date | null,
  ): Promise<number> {
    let q = this.db
      .selectFrom("conversations")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId);
    if (since) {
      q = q.where("created_at", ">=", since.toISOString());
    }
    if (until) {
      q = q.where("created_at", "<", until.toISOString());
    }
    const { count } = await q.executeTakeFirstOrThrow();
    return Number(count);
  }

  /**
   * Per-day counts for the dashboard hero chart + KPI sparklines, over a trailing
   * window (7d → 7 points, otherwise 30). Buckets in UTC so the series is stable
   * regardless of the DB session timezone. All counts are real successful actions
   * (invites/messages) and inbound lead events (accepts/replies).
   */
  private async dailySeries(workspaceId: string, days: number) {
    const today = new Date();
    const startUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const sinceIso = new Date(startUtc - (days - 1) * 86_400_000).toISOString();
    const dayOf = (col: "executed_at" | "occurred_at") =>
      sql<string>`to_char(date_trunc('day', ${sql.ref(col)} at time zone 'UTC'), 'YYYY-MM-DD')`;

    const [actionRows, eventRows] = await Promise.all([
      this.db
        .selectFrom("actions")
        .select((eb) => [dayOf("executed_at").as("day"), "type", eb.fn.countAll<string>().as("count")])
        .where("workspace_id", "=", workspaceId)
        .where("status", "=", "success")
        .where("executed_at", ">=", sinceIso)
        .groupBy(["day", "type"])
        .execute(),
      this.db
        .selectFrom("lead_events")
        .select((eb) => [dayOf("occurred_at").as("day"), "type", eb.fn.countAll<string>().as("count")])
        .where("workspace_id", "=", workspaceId)
        .where("occurred_at", ">=", sinceIso)
        .groupBy(["day", "type"])
        .execute(),
    ]);

    type Point = { invites: number; messages: number; accepted: number; replies: number };
    const byDay = new Map<string, Point>();
    const at = (d: string): Point => {
      let p = byDay.get(d);
      if (!p) {
        p = { invites: 0, messages: 0, accepted: 0, replies: 0 };
        byDay.set(d, p);
      }
      return p;
    };
    for (const r of actionRows) {
      if (r.type === "connection_request") at(r.day).invites += Number(r.count);
      else if (r.type === "message") at(r.day).messages += Number(r.count);
    }
    for (const r of eventRows) {
      if (r.type === "invite_accepted") at(r.day).accepted += Number(r.count);
      else if (r.type === "reply") at(r.day).replies += Number(r.count);
    }

    const series: ({ date: string } & Point)[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(startUtc - i * 86_400_000).toISOString().slice(0, 10);
      series.push({ date, ...(byDay.get(date) ?? { invites: 0, messages: 0, accepted: 0, replies: 0 }) });
    }
    return series;
  }

  async workspace(workspaceId: string, range: AnalyticsRange = "all") {
    const { since, prevSince, prevUntil } = rangeWindow(range);
    const series = await this.dailySeries(workspaceId, range === "7d" ? 7 : 30);

    const counts = await this.actionCounts(workspaceId, { since });
    const engagements = ENGAGEMENT_TYPES.reduce((sum, t) => sum + (counts[t] ?? 0), 0);
    const accepts = await this.countLeadEvents(workspaceId, "invite_accepted", since);
    const replies = await this.countLeadEvents(workspaceId, "reply", since);
    const convoCount = await this.countConversations(workspaceId, since);

    const leadRows = await this.db
      .selectFrom("leads")
      .select("tags")
      .where("workspace_id", "=", workspaceId)
      .execute();
    const tagCounts = new Map<string, number>();
    for (const r of leadRows) {
      for (const t of r.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const tags = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const connections = counts.connection_request ?? 0;
    const messages = counts.message ?? 0;

    // Period-over-period deltas for the headline cards (null for "all" or no base).
    let deltas: {
      connections: number | null;
      conversations: number | null;
      replies: number | null;
      acceptedInvites: number | null;
    } | null = null;
    if (prevSince && prevUntil) {
      const [prevCounts, prevConvos, prevReplies, prevAccepts] = await Promise.all([
        this.actionCounts(workspaceId, { since: prevSince, until: prevUntil }),
        this.countConversations(workspaceId, prevSince, prevUntil),
        this.countLeadEvents(workspaceId, "reply", prevSince, prevUntil),
        this.countLeadEvents(workspaceId, "invite_accepted", prevSince, prevUntil),
      ]);
      deltas = {
        connections: delta(connections, prevCounts.connection_request ?? 0),
        conversations: delta(convoCount, prevConvos),
        replies: delta(replies, prevReplies),
        acceptedInvites: delta(accepts, prevAccepts),
      };
    }

    return {
      range,
      connections,
      conversations: convoCount,
      engagements,
      inmails: counts.inmail ?? 0,
      messages,
      acceptedInvites: accepts,
      replies,
      acceptanceRate: pct(accepts, connections),
      replyRate: pct(replies, messages),
      deltas,
      series,
      tags,
    };
  }

  /**
   * AI SDR performance — what the autonomous agent actually did: replies it sent
   * on the user's behalf, distinct conversations it handled, hot leads it
   * escalated (with a briefing), total handoffs, and drafts still awaiting
   * approval. Powers the "AI replied to N, escalated M hot leads, saved ~X hrs"
   * surface — the answer to "is this real AI or a scheduler with GPT on top".
   */
  async aiSdr(workspaceId: string, range: AnalyticsRange = "all") {
    const { since } = rangeWindow(range);
    const [aiReplies, conversationsHandled, hotLeads, escalations, pendingDrafts] = await Promise.all([
      this.countMessages(workspaceId, { authoredBy: "ai", since }),
      this.countMessages(workspaceId, { authoredBy: "ai", since, distinctConversations: true }),
      this.countNotifications(workspaceId, "hot_lead", since),
      this.countDrafts(workspaceId, { status: "escalated", since }),
      this.countDrafts(workspaceId, { status: "pending" }),
    ]);
    // Rough time-saved estimate: ~3 minutes of human reply-writing per AI reply.
    const estimatedHoursSaved = Math.round((aiReplies * 3) / 6) / 10;
    return { range, aiReplies, conversationsHandled, hotLeads, escalations, pendingDrafts, estimatedHoursSaved };
  }

  /**
   * The dashboard "Waiting on you" review queue — every AI suggestion that needs a
   * human: pending drafts (approve/edit/discard) and escalations (hot leads to take
   * over). Projects existing tables (message_drafts + relationship_state + the last
   * inbound message) so the dashboard reuses the SAME approve/discard actions the
   * inbox already exposes — no new write path, no fabricated data. Scoped to
   * connected accounts (mirrors the inbox unibox), newest first.
   */
  async reviewQueue(workspaceId: string, limit = 8) {
    const rows = await this.db
      .selectFrom("message_drafts as d")
      .innerJoin("conversations as c", "c.id", "d.conversation_id")
      .innerJoin("sending_accounts as sa", "sa.id", "c.account_id")
      .leftJoin("leads as l", "l.id", "c.lead_id")
      .leftJoin("relationship_state as r", "r.lead_id", "c.lead_id")
      .select([
        "d.id as draftId",
        "d.conversation_id as conversationId",
        "d.status as status",
        "d.body as body",
        "d.confidence as confidence",
        "d.reasoning as reasoning",
        "d.created_at as createdAt",
        "l.enrichment as enrichment",
        "l.email as email",
        "l.linkedin_url as linkedinUrl",
        "r.intent_score as intentScore",
        "r.stage as relStage",
        "r.summary as relSummary",
        "r.next_action as relNextAction",
      ])
      .where("d.workspace_id", "=", workspaceId)
      .where("d.status", "in", ["pending", "escalated"])
      .where("sa.status", "in", ["active", "warming"])
      .orderBy("d.created_at", "desc")
      .limit(Math.min(Math.max(limit, 1), 25))
      .execute();

    const lastInbound = await this.lastInboundMessages(rows.map((r) => r.conversationId));

    const items = rows.map((r) => {
      const reasoning = asObject(r.reasoning);
      const reason = (reasoning.reason as string | undefined) ?? null;
      const isHot = r.status === "escalated" && (reason === "hot_lead" || r.relStage === "hot_lead");
      const e = asObject(r.enrichment);
      return {
        draftId: r.draftId,
        conversationId: r.conversationId,
        leadName: leadName(r.enrichment, r.email, r.linkedinUrl),
        role: typeof e.role === "string" ? e.role : null,
        company: typeof e.company === "string" ? e.company : null,
        headline: typeof e.headline === "string" ? e.headline : null,
        // "draft" = pending reply awaiting approval; "hot_lead" = escalated buyer to
        // take over; "escalation" = any other AI handoff (out-of-KB, hard-no, …).
        kind: r.status === "pending" ? "draft" : isHot ? "hot_lead" : "escalation",
        status: r.status,
        reason,
        body: r.body,
        confidence: r.confidence,
        summary: (reasoning.summary as string | undefined) ?? r.relSummary ?? null,
        nextStep: (reasoning.nextStep as string | undefined) ?? r.relNextAction ?? null,
        intentScore: r.intentScore ?? null,
        isHot,
        lastInbound: lastInbound.get(r.conversationId) ?? null,
        createdAt: r.createdAt,
      };
    });

    // Workspace-wide totals for the header badge ("N drafts · M hot") — independent
    // of the display limit.
    const [{ count: draftCount }, { count: hotCount }] = await Promise.all([
      this.db
        .selectFrom("message_drafts")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("workspace_id", "=", workspaceId)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom("message_drafts")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("workspace_id", "=", workspaceId)
        .where("status", "=", "escalated")
        .where((eb) => eb(sql<string>`reasoning->>'reason'`, "=", "hot_lead"))
        .executeTakeFirstOrThrow(),
    ]);

    return { items, counts: { drafts: Number(draftCount), hot: Number(hotCount) } };
  }

  /** Latest inbound (lead → you) message per conversation — the "what they asked" line. */
  private async lastInboundMessages(conversationIds: string[]) {
    const map = new Map<string, { body: string | null; at: string }>();
    if (conversationIds.length === 0) {
      return map;
    }
    const rows = await this.db
      .selectFrom("messages")
      .select(["conversation_id", "body", "created_at"])
      .where("conversation_id", "in", conversationIds)
      .where("direction", "=", "inbound")
      .orderBy("created_at", "desc")
      .execute();
    for (const m of rows) {
      if (!map.has(m.conversation_id)) {
        map.set(m.conversation_id, { body: m.body, at: m.created_at });
      }
    }
    return map;
  }

  /** Outbound message count, optionally by author + window, or distinct conversations. */
  private async countMessages(
    workspaceId: string,
    opts: { authoredBy?: "human" | "ai"; since?: Date | null; distinctConversations?: boolean },
  ): Promise<number> {
    let q = this.db
      .selectFrom("messages")
      .select((eb) =>
        (opts.distinctConversations
          ? eb.fn.count<string>("conversation_id").distinct()
          : eb.fn.countAll<string>()
        ).as("count"),
      )
      .where("workspace_id", "=", workspaceId)
      .where("direction", "=", "outbound");
    if (opts.authoredBy) q = q.where("authored_by", "=", opts.authoredBy);
    if (opts.since) q = q.where("created_at", ">=", opts.since.toISOString());
    const { count } = await q.executeTakeFirstOrThrow();
    return Number(count);
  }

  private async countNotifications(workspaceId: string, type: string, since?: Date | null): Promise<number> {
    let q = this.db
      .selectFrom("notifications")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", type);
    if (since) q = q.where("created_at", ">=", since.toISOString());
    const { count } = await q.executeTakeFirstOrThrow();
    return Number(count);
  }

  private async countDrafts(
    workspaceId: string,
    opts: { status: "pending" | "escalated"; since?: Date | null },
  ): Promise<number> {
    let q = this.db
      .selectFrom("message_drafts")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("status", "=", opts.status);
    if (opts.since) q = q.where("created_at", ">=", opts.since.toISOString());
    const { count } = await q.executeTakeFirstOrThrow();
    return Number(count);
  }

  async campaign(workspaceId: string, campaignId: string) {
    const counts = await this.actionCounts(workspaceId, { campaignId });
    const requests = counts.connection_request ?? 0;
    const messages = counts.message ?? 0;

    const accepted = await this.db
      .selectFrom("lead_events as le")
      .innerJoin("lead_campaign_state as lcs", (join) =>
        join.onRef("lcs.lead_id", "=", "le.lead_id").on("lcs.campaign_id", "=", campaignId),
      )
      .select((eb) => eb.fn.count<string>("le.lead_id").distinct().as("count"))
      .where("le.workspace_id", "=", workspaceId)
      .where("le.type", "=", "invite_accepted")
      .executeTakeFirstOrThrow();
    const acceptedCount = Number(accepted.count);

    const { count: replied } = await this.db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("status", "=", "replied")
      .executeTakeFirstOrThrow();
    const repliesCount = Number(replied);

    const pastActions = await this.db
      .selectFrom("actions as a")
      .leftJoin("leads as l", "l.id", "a.lead_id")
      .select([
        "a.type as type",
        "a.status as status",
        "a.executed_at as executedAt",
        "l.enrichment as enrichment",
        "l.email as email",
        "l.linkedin_url as linkedinUrl",
      ])
      .where("a.workspace_id", "=", workspaceId)
      .where("a.campaign_id", "=", campaignId)
      .where("a.executed_at", "is not", null)
      .orderBy("a.executed_at", "desc")
      .limit(50)
      .execute();

    return {
      requests,
      messages,
      acceptedInvites: { count: acceptedCount, pct: pct(acceptedCount, requests) },
      replies: { count: repliesCount, pct: pct(repliesCount, messages || requests) },
      openMessages: counts.open_profile_message ?? 0,
      likes: counts.like_post ?? 0,
      comments: (counts.comment_post ?? 0) + (counts.reply_comment ?? 0),
      inmails: counts.inmail ?? 0,
      voiceNotes: counts.voice_note ?? 0,
      pastActions: pastActions.map((a) => ({
        type: a.type,
        status: a.status,
        at: a.executedAt,
        lead: leadName(a.enrichment, a.email, a.linkedinUrl),
      })),
    };
  }

  async accounts(workspaceId: string) {
    const rows = await this.db
      .selectFrom("sending_accounts")
      .select(["id", "name", "status", "health_score", "warmup_state"])
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "linkedin")
      .execute();

    const out = [];
    for (const a of rows) {
      const today = new Date();
      const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const sentRows = await this.db
        .selectFrom("actions")
        .select((eb) => ["type", eb.fn.countAll<string>().as("count")])
        .where("account_id", "=", a.id)
        .where("status", "=", "success")
        .where("executed_at", ">=", startOfDay.toISOString())
        .groupBy("type")
        .execute();
      const today_counts: Record<string, number> = {};
      for (const r of sentRows) {
        today_counts[r.type] = Number(r.count);
      }

      const totalRows = await this.db
        .selectFrom("actions")
        .select((eb) => ["type", eb.fn.countAll<string>().as("count")])
        .where("account_id", "=", a.id)
        .where("status", "=", "success")
        .groupBy("type")
        .execute();
      const totals: Record<string, number> = {};
      for (const r of totalRows) {
        totals[r.type] = Number(r.count);
      }

      const accepts = await this.db
        .selectFrom("lead_events")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("account_id", "=", a.id)
        .where("type", "=", "invite_accepted")
        .executeTakeFirstOrThrow();
      const replies = await this.db
        .selectFrom("lead_events")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("account_id", "=", a.id)
        .where("type", "=", "reply")
        .executeTakeFirstOrThrow();

      const ageDays = ageDaysSince(asObject(a.warmup_state).startedAt as string | undefined);
      const caps = effectiveCaps(
        // base caps unknown per account here; use defaults via effectiveCaps on a default map
        {
          connection_request: 15,
          message: 30,
          voice_note: 20,
          inmail: 5,
          open_profile_message: 30,
          comment_post: 30,
          reply_comment: 30,
          like_post: 30,
          visit_profile: 30,
          follow_lead: 30,
        },
        ageDays,
      );
      const health = computeHealth({
        connectionRequestsSent: totals.connection_request ?? 0,
        invitesAccepted: Number(accepts.count),
        messagesSent: totals.message ?? 0,
        replies: Number(replies.count),
        restrictionEvents: a.status === "restricted" ? 1 : 0,
        captchaEvents: 0,
      });

      out.push({
        id: a.id,
        name: a.name,
        status: a.status,
        healthScore: a.health_score,
        computedHealth: health.score,
        acceptanceRate: health.acceptanceRate === null ? null : Math.round(health.acceptanceRate * 100),
        replyRate: health.replyRate === null ? null : Math.round(health.replyRate * 100),
        connectionRequestsToday: today_counts.connection_request ?? 0,
        connectionRequestCap: caps.connection_request,
        signals: health.signals,
      });
    }
    return out;
  }

  /** Workspace unit economics: AI spend per outcome (cost-per-conversation / booked meeting). */
  unitEconomics(workspaceId: string, range: AnalyticsRange) {
    const windowDays = range === "7d" ? 7 : range === "30d" ? 30 : undefined;
    return computeUnitEconomics(this.db, { workspaceId, windowDays });
  }

  /** Per-campaign unit economics — same metrics scoped to a single campaign. */
  campaignUnitEconomics(workspaceId: string, campaignId: string, range: AnalyticsRange) {
    const windowDays = range === "7d" ? 7 : range === "30d" ? 30 : undefined;
    return computeUnitEconomics(this.db, { workspaceId, campaignId, windowDays });
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("workspace")
  workspace(@WorkspaceId() workspaceId: string, @Query("range") range?: string) {
    return this.analytics.workspace(workspaceId, parseAnalyticsRange(range));
  }

  @Get("campaign/:id")
  campaign(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.analytics.campaign(workspaceId, id);
  }

  @Get("campaign/:id/unit-economics")
  campaignUnitEconomics(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Query("range") range?: string,
  ) {
    return this.analytics.campaignUnitEconomics(workspaceId, id, parseAnalyticsRange(range));
  }

  @Get("accounts")
  accounts(@WorkspaceId() workspaceId: string) {
    return this.analytics.accounts(workspaceId);
  }

  @Get("ai-sdr")
  aiSdr(@WorkspaceId() workspaceId: string, @Query("range") range?: string) {
    return this.analytics.aiSdr(workspaceId, parseAnalyticsRange(range));
  }

  @Get("review-queue")
  reviewQueue(@WorkspaceId() workspaceId: string, @Query("limit") limit?: string) {
    const n = Number.parseInt(limit ?? "", 10);
    return this.analytics.reviewQueue(workspaceId, Number.isFinite(n) ? n : 8);
  }

  @Get("unit-economics")
  unitEconomics(@WorkspaceId() workspaceId: string, @Query("range") range?: string) {
    return this.analytics.unitEconomics(workspaceId, parseAnalyticsRange(range));
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
