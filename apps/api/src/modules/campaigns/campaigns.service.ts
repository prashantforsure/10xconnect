import {
  CAPPED_ACTION_TYPES,
  clampCaps,
  type DailyCaps,
  defaultDailyCaps,
  defaultWeekSchedule,
  validateSchedule,
  type WeekSchedule,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { KYSELY_DB } from "../../database/database.module";

import { DEFAULT_AI_REPLY_MODE } from "./dto";
import type {
  CreateCampaignDto,
  SaveFrequencyDto,
  SaveScheduleDto,
  UpdateCampaignDto,
} from "./dto";

// "pending" was removed — no flow ever set it (a scheduled-launch feature may reintroduce it).
// "paused" = frozen-but-resumable (distinct from "stopped", which is terminal).
export type CampaignStatus = "draft" | "running" | "paused" | "stopped" | "completed";

export interface CampaignSettings {
  skip_already_contacted: boolean;
  exclude_conn_req_from_reply_rate: boolean;
  /** Advisory follow-up discipline cap (max follow-ups per lead). */
  follow_up_cap: number;
  /** Full-silence pause: while paused, ALSO defer AI conversation replies
   * (default false — pause freezes the sequence but the AI keeps answering). */
  pause_ai_replies?: boolean;
}

const DEFAULT_SETTINGS: CampaignSettings = {
  skip_already_contacted: true,
  exclude_conn_req_from_reply_rate: true,
  follow_up_cap: 3,
};

/** Headline outreach metrics for the campaigns list (all real, from actions/events/state). */
export interface CampaignMetrics {
  sent: number;
  accepted: number;
  acceptRate: number; // %
  replyRate: number; // %
  progress: number; // % of enrolled leads that reached a terminal step
}

/** A LinkedIn account shown in the campaign sender-pool picker (§6 multi-account). */
export interface SenderOption {
  id: string;
  name: string | null;
  label: string | null;
  status: string;
  avatar_url: string | null;
  country: string | null;
}

export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  accountId: string | null;
  settings: CampaignSettings;
  shareToken: string | null;
  leadCount: number;
  metrics?: CampaignMetrics;
  createdAt: string;
  updatedAt: string;
}

const TERMINAL_LEAD_STATES = new Set(["completed", "stopped", "replied", "skipped"]);
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async create(workspaceId: string, dto: CreateCampaignDto): Promise<CampaignView> {
    if (dto.accountId) {
      await this.assertAccountInWorkspace(workspaceId, dto.accountId);
    }
    const row = await this.db
      .insertInto("campaigns")
      .values({
        workspace_id: workspaceId,
        name: dto.name,
        status: "draft",
        account_id: dto.accountId ?? null,
        caps: JSON.stringify(defaultDailyCaps()),
        schedule: JSON.stringify(defaultWeekSchedule()),
        settings: JSON.stringify(DEFAULT_SETTINGS),
        // AI reply autonomy chosen by the creator (Manual / Balanced / Autopilot);
        // defaults to Balanced so new campaigns auto-reply to normal conversation.
        autonomy: JSON.stringify({ mode: dto.aiReplyMode ?? DEFAULT_AI_REPLY_MODE }),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.logger.log(`Created campaign ${row.id} (workspace=${workspaceId})`);
    return this.toView(row, 0);
  }

  async list(workspaceId: string): Promise<CampaignView[]> {
    const rows = await this.db
      .selectFrom("campaigns")
      .selectAll()
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();

    const { totals, metrics } = await this.campaignMetrics(
      workspaceId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      ...this.toView(r, totals.get(r.id) ?? 0),
      metrics: metrics.get(r.id) ?? { sent: 0, accepted: 0, acceptRate: 0, replyRate: 0, progress: 0 },
    }));
  }

  async detail(workspaceId: string, id: string): Promise<CampaignView> {
    const row = await this.getRowOr404(workspaceId, id);
    const counts = await this.leadCounts(workspaceId, [id]);
    return this.toView(row, counts.get(id) ?? 0);
  }

  async update(workspaceId: string, id: string, dto: UpdateCampaignDto): Promise<CampaignView> {
    const current = await this.getRowOr404(workspaceId, id);
    if (dto.accountId) {
      await this.assertAccountInWorkspace(workspaceId, dto.accountId);
    }
    const nextSettings = dto.settings
      ? { ...this.parseSettings(current.settings), ...dto.settings }
      : undefined;

    const row = await this.db
      .updateTable("campaigns")
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.accountId !== undefined ? { account_id: dto.accountId } : {}),
        ...(nextSettings ? { settings: JSON.stringify(nextSettings) } : {}),
      })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    const counts = await this.leadCounts(workspaceId, [id]);
    return this.toView(row, counts.get(id) ?? 0);
  }

  async remove(workspaceId: string, id: string): Promise<{ deleted: true; id: string }> {
    await this.getRowOr404(workspaceId, id);
    // FK ON DELETE CASCADE removes sequence_nodes + lead_campaign_state.
    await this.db
      .deleteFrom("campaigns")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .execute();
    return { deleted: true, id };
  }

  // --- Frequency (caps) ----------------------------------------------------

  async getFrequency(
    workspaceId: string,
    id: string,
  ): Promise<{ caps: DailyCaps; defaults: DailyCaps; ceilings: Record<string, number> }> {
    const row = await this.getRowOr404(workspaceId, id);
    return {
      caps: this.parseCaps(row.caps),
      defaults: defaultDailyCaps(),
      ceilings: this.ceilings(),
    };
  }

  /** Clamp requested caps to safe maxima (never silently exceed), then persist. */
  async saveFrequency(
    workspaceId: string,
    id: string,
    dto: SaveFrequencyDto,
  ): Promise<{ caps: DailyCaps; warnings: string[] }> {
    await this.getRowOr404(workspaceId, id);
    const { caps, warnings } = clampCaps(dto.caps);
    await this.db
      .updateTable("campaigns")
      .set({ caps: JSON.stringify(caps) })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .execute();
    if (warnings.length > 0) {
      this.logger.warn(`Campaign ${id} caps clamped: ${warnings.join("; ")}`);
    }
    return { caps, warnings };
  }

  // --- Schedule ------------------------------------------------------------

  async getSchedule(workspaceId: string, id: string): Promise<{ schedule: WeekSchedule }> {
    const row = await this.getRowOr404(workspaceId, id);
    return { schedule: this.parseSchedule(row.schedule) };
  }

  async saveSchedule(
    workspaceId: string,
    id: string,
    dto: SaveScheduleDto,
  ): Promise<{ schedule: WeekSchedule; warnings: string[] }> {
    await this.getRowOr404(workspaceId, id);
    const validation = validateSchedule(dto.schedule);
    if (!validation.valid) {
      throw new BadRequestException(validation.errors.join(" "));
    }
    await this.db
      .updateTable("campaigns")
      .set({ schedule: JSON.stringify(dto.schedule) })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .execute();
    return { schedule: dto.schedule, warnings: validation.warnings };
  }

  // --- Status --------------------------------------------------------------

  async getStatus(
    workspaceId: string,
    id: string,
  ): Promise<{ status: CampaignStatus; counts: { total: number; byStatus: Record<string, number> } }> {
    const row = await this.getRowOr404(workspaceId, id);
    const stateRows = await this.db
      .selectFrom("lead_campaign_state")
      .select((eb) => ["status", eb.fn.countAll<string>().as("count")])
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", id)
      .groupBy("status")
      .execute();
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of stateRows) {
      const n = Number(r.count);
      byStatus[r.status] = n;
      total += n;
    }
    return { status: row.status as CampaignStatus, counts: { total, byStatus } };
  }

  // --- helpers (shared with the sequence/run module in M4) -----------------

  async getRowOr404(workspaceId: string, id: string) {
    const row = await this.db
      .selectFrom("campaigns")
      .selectAll()
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException("Campaign not found");
    }
    return row;
  }

  private async assertAccountInWorkspace(workspaceId: string, accountId: string): Promise<void> {
    const account = await this.db
      .selectFrom("sending_accounts")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", accountId)
      .executeTakeFirst();
    if (!account) {
      throw new BadRequestException("Sending account not found in this workspace");
    }
  }

  private async assertCampaign(workspaceId: string, campaignId: string): Promise<void> {
    const row = await this.db
      .selectFrom("campaigns")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException("Campaign not found");
    }
  }

  /**
   * The campaign's sender POOL (multi-account rotation) plus every LinkedIn account
   * in the workspace to pick from. Falls back to [account_id] so a legacy single-
   * account campaign still reports its one sender. `accounts` powers the picker.
   */
  async getSenders(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ accountIds: string[]; accounts: SenderOption[] }> {
    await this.assertCampaign(workspaceId, campaignId);
    const [pool, campaign, accounts] = await Promise.all([
      this.db
        .selectFrom("campaign_accounts")
        .select("account_id")
        .where("workspace_id", "=", workspaceId)
        .where("campaign_id", "=", campaignId)
        .orderBy("created_at", "asc")
        .execute(),
      this.db
        .selectFrom("campaigns")
        .select("account_id")
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", campaignId)
        .executeTakeFirst(),
      this.db
        .selectFrom("sending_accounts")
        .select(["id", "name", "label", "status", "avatar_url", "country"])
        .where("workspace_id", "=", workspaceId)
        .where("type", "=", "linkedin")
        .orderBy("created_at", "asc")
        .execute(),
    ]);
    const accountIds =
      pool.length > 0
        ? pool.map((p) => p.account_id)
        : campaign?.account_id
          ? [campaign.account_id]
          : [];
    return { accountIds, accounts: accounts as SenderOption[] };
  }

  /**
   * Replace the campaign's sender pool. Every id must be a LinkedIn account in the
   * workspace. Also anchors campaigns.account_id to the FIRST pool member (the
   * primary/default sender) so single-account code paths + analytics stay stable.
   */
  async setSenders(
    workspaceId: string,
    campaignId: string,
    accountIds: string[],
  ): Promise<{ accountIds: string[] }> {
    await this.assertCampaign(workspaceId, campaignId);
    const unique = [...new Set(accountIds)];
    if (unique.length > 0) {
      const rows = await this.db
        .selectFrom("sending_accounts")
        .select("id")
        .where("workspace_id", "=", workspaceId)
        .where("type", "=", "linkedin")
        .where("id", "in", unique)
        .execute();
      const found = new Set(rows.map((r) => r.id));
      if (unique.some((id) => !found.has(id))) {
        throw new BadRequestException(
          "Every sender must be a LinkedIn account connected to this workspace.",
        );
      }
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("campaign_accounts").where("campaign_id", "=", campaignId).execute();
      if (unique.length > 0) {
        await trx
          .insertInto("campaign_accounts")
          .values(
            unique.map((id) => ({ workspace_id: workspaceId, campaign_id: campaignId, account_id: id })),
          )
          .execute();
      }
      await trx
        .updateTable("campaigns")
        .set({ account_id: unique[0] ?? null })
        .where("id", "=", campaignId)
        .where("workspace_id", "=", workspaceId)
        .execute();
    });
    this.logger.log(`Set ${unique.length} sender(s) on campaign ${campaignId}`);
    return { accountIds: unique };
  }

  /**
   * Batched per-campaign metrics for the list view. Three grouped queries cover
   * all campaigns at once (lead-state breakdown, successful actions by type, and
   * accepted invites), so the list stays O(1) in round-trips regardless of count.
   */
  private async campaignMetrics(
    workspaceId: string,
    ids: string[],
  ): Promise<{ totals: Map<string, number>; metrics: Map<string, CampaignMetrics> }> {
    const totals = new Map<string, number>();
    const metrics = new Map<string, CampaignMetrics>();
    if (ids.length === 0) {
      return { totals, metrics };
    }

    // 1) Lead-campaign-state breakdown → total enrolled, replied, terminal (done).
    const stateRows = await this.db
      .selectFrom("lead_campaign_state")
      .select((eb) => ["campaign_id", "status", eb.fn.countAll<string>().as("count")])
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "in", ids)
      .groupBy(["campaign_id", "status"])
      .execute();
    const stateAgg = new Map<string, { total: number; replied: number; done: number }>();
    for (const r of stateRows) {
      const a = stateAgg.get(r.campaign_id) ?? { total: 0, replied: 0, done: 0 };
      const c = Number(r.count);
      a.total += c;
      if (r.status === "replied") a.replied += c;
      if (TERMINAL_LEAD_STATES.has(r.status)) a.done += c;
      stateAgg.set(r.campaign_id, a);
    }

    // 2) Successful actions by campaign + type → sent (all), connection requests, messages.
    const actionRows = await this.db
      .selectFrom("actions")
      .select((eb) => ["campaign_id", "type", eb.fn.countAll<string>().as("count")])
      .where("workspace_id", "=", workspaceId)
      .where("status", "=", "success")
      .where("campaign_id", "in", ids)
      .groupBy(["campaign_id", "type"])
      .execute();
    const actionAgg = new Map<string, { sent: number; conn: number; msg: number }>();
    for (const r of actionRows) {
      if (!r.campaign_id) continue;
      const a = actionAgg.get(r.campaign_id) ?? { sent: 0, conn: 0, msg: 0 };
      const c = Number(r.count);
      a.sent += c;
      if (r.type === "connection_request") a.conn += c;
      if (r.type === "message") a.msg += c;
      actionAgg.set(r.campaign_id, a);
    }

    // 3) Accepted invites per campaign (distinct leads with an invite_accepted event).
    const acceptedRows = await this.db
      .selectFrom("lead_events as le")
      .innerJoin("lead_campaign_state as lcs", (join) =>
        join.onRef("lcs.lead_id", "=", "le.lead_id").onRef("lcs.workspace_id", "=", "le.workspace_id"),
      )
      .select((eb) => ["lcs.campaign_id as campaign_id", eb.fn.count<string>("le.lead_id").distinct().as("count")])
      .where("le.workspace_id", "=", workspaceId)
      .where("le.type", "=", "invite_accepted")
      .where("lcs.campaign_id", "in", ids)
      .groupBy("lcs.campaign_id")
      .execute();
    const acceptedMap = new Map<string, number>();
    for (const r of acceptedRows) {
      acceptedMap.set(r.campaign_id, Number(r.count));
    }

    for (const id of ids) {
      const st = stateAgg.get(id) ?? { total: 0, replied: 0, done: 0 };
      const act = actionAgg.get(id) ?? { sent: 0, conn: 0, msg: 0 };
      const accepted = acceptedMap.get(id) ?? 0;
      totals.set(id, st.total);
      metrics.set(id, {
        sent: act.sent,
        accepted,
        acceptRate: pct(accepted, act.conn),
        replyRate: pct(st.replied, act.msg || act.conn),
        progress: pct(st.done, st.total),
      });
    }
    return { totals, metrics };
  }

  private async leadCounts(workspaceId: string, ids: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (ids.length === 0) {
      return counts;
    }
    const rows = await this.db
      .selectFrom("lead_campaign_state")
      .select((eb) => ["campaign_id", eb.fn.countAll<string>().as("count")])
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "in", ids)
      .groupBy("campaign_id")
      .execute();
    for (const r of rows) {
      counts.set(r.campaign_id, Number(r.count));
    }
    return counts;
  }

  private ceilings(): Record<string, number> {
    // Lazily reference MAX caps via clampCaps result is awkward; expose ceilings
    // explicitly so the UI can warn before saving. Import kept local to avoid a
    // wider surface; MAX_DAILY_CAPS is the source of truth.
    const all = clampCaps(
      Object.fromEntries(CAPPED_ACTION_TYPES.map((t) => [t, Number.MAX_SAFE_INTEGER])),
    );
    return all.caps;
  }

  parseCaps(value: unknown): DailyCaps {
    const stored = this.asObject(value);
    const caps = defaultDailyCaps();
    for (const type of CAPPED_ACTION_TYPES) {
      const v = stored[type];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        caps[type] = Math.floor(v);
      }
    }
    return caps;
  }

  parseSchedule(value: unknown): WeekSchedule {
    const stored = this.asObject(value);
    const def = defaultWeekSchedule();
    const days = Object.keys(def) as (keyof WeekSchedule)[];
    const out = { ...def };
    for (const day of days) {
      const d = this.asObject(stored[day]);
      if (typeof d.enabled === "boolean" && typeof d.start === "string" && typeof d.end === "string") {
        out[day] = { enabled: d.enabled, start: d.start, end: d.end };
      }
    }
    return out;
  }

  parseSettings(value: unknown): CampaignSettings {
    const stored = this.asObject(value);
    return {
      skip_already_contacted:
        typeof stored.skip_already_contacted === "boolean"
          ? stored.skip_already_contacted
          : DEFAULT_SETTINGS.skip_already_contacted,
      exclude_conn_req_from_reply_rate:
        typeof stored.exclude_conn_req_from_reply_rate === "boolean"
          ? stored.exclude_conn_req_from_reply_rate
          : DEFAULT_SETTINGS.exclude_conn_req_from_reply_rate,
      follow_up_cap:
        typeof stored.follow_up_cap === "number"
          ? Math.max(0, Math.min(20, Math.round(stored.follow_up_cap)))
          : DEFAULT_SETTINGS.follow_up_cap,
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toView(
    row: {
      id: string;
      name: string;
      status: string;
      account_id: string | null;
      settings: unknown;
      share_token: string | null;
      created_at: string;
      updated_at: string;
    },
    leadCount: number,
  ): CampaignView {
    return {
      id: row.id,
      name: row.name,
      status: row.status as CampaignStatus,
      accountId: row.account_id,
      settings: this.parseSettings(row.settings),
      shareToken: row.share_token,
      leadCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
