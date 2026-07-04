import type { DB } from "@10xconnect/db";
import { Controller, Get, Inject, Injectable, Module } from "@nestjs/common";
import type { Kysely } from "kysely";

import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";
import { KYSELY_DB } from "../database/database.module";

// AGENCY OVERVIEW (agency parity — HeyReach/Aimfox "manage all clients in one
// place"; the #1 G2 ask is deeper reporting). A cross-CLIENT rollup: every
// workspace the caller belongs to, with per-client performance + account health,
// plus agency totals. Auth-only (NO WorkspaceScopeGuard) — but every query is
// restricted to the caller's memberships-derived workspace ids, so a member never
// sees a workspace they aren't in (the service-role connection bypasses RLS, so
// this scoping IS the tenant boundary here).

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function parseBrand(value: unknown): { name: string | null; primaryColor: string | null; logoUrl: string | null } {
  const b =
    typeof value === "string"
      ? safeJson(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { name: str(b.brandName), primaryColor: str(b.primaryColor), logoUrl: str(b.logoUrl) };
}
function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface AgencyClientRow {
  workspaceId: string;
  name: string;
  role: string;
  brand: { name: string | null; primaryColor: string | null; logoUrl: string | null };
  leads: number;
  activeCampaigns: number;
  totalCampaigns: number;
  connectionRequests: number;
  accepted: number;
  acceptRate: number;
  messages: number;
  replies: number;
  replyRate: number;
  accounts: { total: number; active: number; warming: number; paused: number; restricted: number };
  avgHealth: number | null;
  needsAttention: number;
}

export interface AgencyOverview {
  totals: {
    clients: number;
    leads: number;
    activeCampaigns: number;
    connectionRequests: number;
    accepted: number;
    replies: number;
    connectedAccounts: number;
    needsAttention: number;
  };
  clients: AgencyClientRow[];
}

@Injectable()
class AgencyService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async overview(userId: string): Promise<AgencyOverview> {
    // 1) The caller's workspaces (the tenant boundary for everything below).
    const memberships = await this.db
      .selectFrom("memberships as m")
      .innerJoin("workspaces as w", "w.id", "m.workspace_id")
      .select(["w.id as id", "w.name as name", "w.branding as branding", "m.role as role", "w.created_at as createdAt"])
      .where("m.user_id", "=", userId)
      .orderBy("w.created_at", "asc")
      .execute();

    const ids = memberships.map((m) => m.id);
    const empty: AgencyOverview = {
      totals: {
        clients: 0,
        leads: 0,
        activeCampaigns: 0,
        connectionRequests: 0,
        accepted: 0,
        replies: 0,
        connectedAccounts: 0,
        needsAttention: 0,
      },
      clients: [],
    };
    if (ids.length === 0) {
      return empty;
    }

    // 2) Grouped rollups — one query each, all scoped to the caller's workspace ids.
    const [leadRows, campaignRows, actionRows, acceptedRows, repliedRows, accountRows, attentionRows] =
      await Promise.all([
        this.db
          .selectFrom("leads")
          .select(["workspace_id", (eb) => eb.fn.countAll<string>().as("c")])
          .where("workspace_id", "in", ids)
          .groupBy("workspace_id")
          .execute(),
        this.db
          .selectFrom("campaigns")
          .select(["workspace_id", "status", (eb) => eb.fn.countAll<string>().as("c")])
          .where("workspace_id", "in", ids)
          .groupBy(["workspace_id", "status"])
          .execute(),
        this.db
          .selectFrom("actions")
          .select(["workspace_id", "type", (eb) => eb.fn.countAll<string>().as("c")])
          .where("workspace_id", "in", ids)
          .where("status", "=", "success")
          .groupBy(["workspace_id", "type"])
          .execute(),
        this.db
          .selectFrom("lead_events")
          .select(["workspace_id", (eb) => eb.fn.count<string>("lead_id").distinct().as("c")])
          .where("workspace_id", "in", ids)
          .where("type", "=", "invite_accepted")
          .groupBy("workspace_id")
          .execute(),
        this.db
          .selectFrom("lead_campaign_state")
          .select(["workspace_id", (eb) => eb.fn.countAll<string>().as("c")])
          .where("workspace_id", "in", ids)
          .where("status", "=", "replied")
          .groupBy("workspace_id")
          .execute(),
        this.db
          .selectFrom("sending_accounts")
          .select(["workspace_id", "status", "health_score"])
          .where("workspace_id", "in", ids)
          .where("type", "=", "linkedin")
          .execute(),
        this.db
          .selectFrom("conversations")
          .select(["workspace_id", (eb) => eb.fn.countAll<string>().as("c")])
          .where("workspace_id", "in", ids)
          .where("needs_attention", "=", true)
          .groupBy("workspace_id")
          .execute(),
      ]);

    const leadBy = mapCount(leadRows);
    const repliedBy = mapCount(repliedRows);
    const acceptedBy = mapCount(acceptedRows);
    const attentionBy = mapCount(attentionRows);

    const activeCampaignsBy = new Map<string, number>();
    const totalCampaignsBy = new Map<string, number>();
    for (const r of campaignRows) {
      const n = Number(r.c);
      totalCampaignsBy.set(r.workspace_id, (totalCampaignsBy.get(r.workspace_id) ?? 0) + n);
      if (r.status === "running" || r.status === "paused") {
        activeCampaignsBy.set(r.workspace_id, (activeCampaignsBy.get(r.workspace_id) ?? 0) + n);
      }
    }

    const connReqBy = new Map<string, number>();
    const messagesBy = new Map<string, number>();
    for (const r of actionRows) {
      if (r.type === "connection_request") connReqBy.set(r.workspace_id, Number(r.c));
      else if (r.type === "message") messagesBy.set(r.workspace_id, Number(r.c));
    }

    // Per-workspace account health buckets + average score.
    const acctBy = new Map<
      string,
      { total: number; active: number; warming: number; paused: number; restricted: number; healthSum: number }
    >();
    for (const a of accountRows) {
      const cur =
        acctBy.get(a.workspace_id) ??
        { total: 0, active: 0, warming: 0, paused: 0, restricted: 0, healthSum: 0 };
      cur.total += 1;
      cur.healthSum += a.health_score ?? 0;
      if (a.status === "active") cur.active += 1;
      else if (a.status === "warming") cur.warming += 1;
      else if (a.status === "paused") cur.paused += 1;
      else if (a.status === "restricted") cur.restricted += 1;
      acctBy.set(a.workspace_id, cur);
    }

    const clients: AgencyClientRow[] = memberships.map((m) => {
      const connectionRequests = connReqBy.get(m.id) ?? 0;
      const messages = messagesBy.get(m.id) ?? 0;
      const accepted = acceptedBy.get(m.id) ?? 0;
      const replies = repliedBy.get(m.id) ?? 0;
      const acct = acctBy.get(m.id);
      return {
        workspaceId: m.id,
        name: m.name,
        role: m.role,
        brand: parseBrand(m.branding),
        leads: leadBy.get(m.id) ?? 0,
        activeCampaigns: activeCampaignsBy.get(m.id) ?? 0,
        totalCampaigns: totalCampaignsBy.get(m.id) ?? 0,
        connectionRequests,
        accepted,
        acceptRate: pct(accepted, connectionRequests),
        messages,
        replies,
        replyRate: pct(replies, messages || connectionRequests),
        accounts: {
          total: acct?.total ?? 0,
          active: acct?.active ?? 0,
          warming: acct?.warming ?? 0,
          paused: acct?.paused ?? 0,
          restricted: acct?.restricted ?? 0,
        },
        avgHealth: acct && acct.total > 0 ? Math.round(acct.healthSum / acct.total) : null,
        needsAttention: attentionBy.get(m.id) ?? 0,
      };
    });

    const sum = (pick: (c: AgencyClientRow) => number): number => clients.reduce((t, c) => t + pick(c), 0);
    return {
      totals: {
        clients: clients.length,
        leads: sum((c) => c.leads),
        activeCampaigns: sum((c) => c.activeCampaigns),
        connectionRequests: sum((c) => c.connectionRequests),
        accepted: sum((c) => c.accepted),
        replies: sum((c) => c.replies),
        connectedAccounts: sum((c) => c.accounts.total),
        needsAttention: sum((c) => c.needsAttention),
      },
      clients,
    };
  }
}

function mapCount(rows: Array<{ workspace_id: string; c: string | number }>): Map<string, number> {
  return new Map(rows.map((r) => [r.workspace_id, Number(r.c)]));
}

// Auth-only (no workspace scope) — like MeController. The global SupabaseAuthGuard
// authenticates; AgencyService restricts to the caller's memberships.
@Controller("agency")
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Get("overview")
  overview(@CurrentUser() user: AuthUser): Promise<AgencyOverview> {
    return this.agency.overview(user.id);
  }
}

@Module({
  controllers: [AgencyController],
  providers: [AgencyService],
})
export class AgencyModule {}
