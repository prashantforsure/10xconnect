import type { DB } from "@10xconnect/db";
import { Controller, Get, Inject, Injectable, Module, NotFoundException, Param } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Kysely } from "kysely";

import { Public } from "../common/decorators/public.decorator";
import { KYSELY_DB } from "../database/database.module";

// White-label CLIENT REPORT (agency parity — HeyReach/Aimfox "white-label client
// reports"). A campaign's share_token unlocks a PUBLIC, unauthenticated,
// aggregate-only performance report an agency can send to its client. It is
// deliberately PII-FREE: only rollup counts + the workspace's branding, never a
// lead name/email/URL — the internal /analytics/campaign shape leaks lead names and
// must NOT be reused here. Resolved by token → campaign → workspace branding.

interface BrandingBlob {
  brandName?: string;
  primaryColor?: string;
  logoUrl?: string;
  customDomain?: string;
}

function parseBranding(value: unknown): BrandingBlob {
  const b =
    typeof value === "string"
      ? safeJson(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    brandName: str(b.brandName),
    primaryColor: str(b.primaryColor),
    logoUrl: str(b.logoUrl),
    customDomain: str(b.customDomain),
  };
}
function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export interface ClientReport {
  brand: { name: string | null; primaryColor: string | null; logoUrl: string | null };
  campaign: { name: string; status: string };
  metrics: {
    contacted: number;
    connectionRequests: number;
    accepted: number;
    acceptRate: number;
    messages: number;
    replies: number;
    replyRate: number;
  };
  funnel: Array<{ label: string; value: number; pct?: number }>;
}

@Injectable()
class PublicReportsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async report(token: string): Promise<ClientReport> {
    if (!token || token.length > 64) {
      throw new NotFoundException("Report not found");
    }
    const campaign = await this.db
      .selectFrom("campaigns")
      .select(["id", "workspace_id", "name", "status"])
      .where("share_token", "=", token)
      .executeTakeFirst();
    if (!campaign) {
      throw new NotFoundException("Report not found");
    }
    const workspaceId = campaign.workspace_id;
    const campaignId = campaign.id;

    const [ws, contactedRow, actionRows, acceptedRow, repliedRow] = await Promise.all([
      this.db.selectFrom("workspaces").select("branding").where("id", "=", workspaceId).executeTakeFirst(),
      this.db
        .selectFrom("lead_campaign_state")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("workspace_id", "=", workspaceId)
        .where("campaign_id", "=", campaignId)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom("actions")
        .select(["type", (eb) => eb.fn.countAll<string>().as("c")])
        .where("workspace_id", "=", workspaceId)
        .where("campaign_id", "=", campaignId)
        .where("status", "=", "success")
        .groupBy("type")
        .execute(),
      this.db
        .selectFrom("lead_events as le")
        .innerJoin("lead_campaign_state as lcs", (join) =>
          join.onRef("lcs.lead_id", "=", "le.lead_id").on("lcs.campaign_id", "=", campaignId),
        )
        .select((eb) => eb.fn.count<string>("le.lead_id").distinct().as("c"))
        .where("le.workspace_id", "=", workspaceId)
        .where("le.type", "=", "invite_accepted")
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom("lead_campaign_state")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("workspace_id", "=", workspaceId)
        .where("campaign_id", "=", campaignId)
        .where("status", "=", "replied")
        .executeTakeFirstOrThrow(),
    ]);

    const byType = new Map(actionRows.map((r) => [r.type, Number(r.c)]));
    const contacted = Number(contactedRow.c);
    const connectionRequests = byType.get("connection_request") ?? 0;
    const messages = byType.get("message") ?? 0;
    const accepted = Number(acceptedRow.c);
    const replies = Number(repliedRow.c);
    const branding = parseBranding(ws?.branding);

    return {
      brand: {
        name: branding.brandName ?? null,
        primaryColor: branding.primaryColor ?? null,
        logoUrl: branding.logoUrl ?? null,
      },
      campaign: { name: campaign.name, status: campaign.status },
      metrics: {
        contacted,
        connectionRequests,
        accepted,
        acceptRate: pct(accepted, connectionRequests),
        messages,
        replies,
        replyRate: pct(replies, messages || connectionRequests),
      },
      funnel: [
        { label: "Contacted", value: contacted },
        { label: "Requests sent", value: connectionRequests },
        { label: "Accepted", value: accepted, pct: pct(accepted, connectionRequests) },
        { label: "Messages sent", value: messages },
        { label: "Replies", value: replies, pct: pct(replies, messages || connectionRequests) },
      ],
    };
  }
}

@Controller("public/campaigns")
export class PublicReportsController {
  constructor(private readonly reports: PublicReportsService) {}

  @Public()
  @SkipThrottle()
  @Get(":token/report")
  report(@Param("token") token: string): Promise<ClientReport> {
    return this.reports.report(token);
  }
}

@Module({
  controllers: [PublicReportsController],
  providers: [PublicReportsService],
})
export class PublicReportsModule {}
