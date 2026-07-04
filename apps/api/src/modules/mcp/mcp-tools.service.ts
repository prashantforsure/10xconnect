// MCP tool registry (integrations Phase D). Builds a per-request McpServer
// whose tools are THIN wrappers over the existing Nest services, always called
// with the API key's pinned workspaceId — the same tenant boundary as the REST
// API. read_only keys get only the read tools (gated at REGISTRATION, so a
// mutating tool simply doesn't exist for them).

import type { DB } from "@10xconnect/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Inject, Injectable } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { z } from "zod";

import type { ApiKeyPrincipal } from "../../auth/api-key-auth.service";
import { KYSELY_DB } from "../../database/database.module";
import { AccountsService } from "../accounts.module";
import { AnalyticsService, parseAnalyticsRange } from "../analytics.module";
import { CampaignRunService } from "../campaigns/campaign-run.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { ConversationsService } from "../conversations.module";
import { WebhooksService, WEBHOOK_EVENTS } from "../webhooks.module";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function json(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolError(error: unknown): ToolResult {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "Tool failed";
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Wrap a handler so service exceptions become MCP tool errors, not 500s. */
function safe<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return json(await fn(args));
    } catch (error) {
      return toolError(error);
    }
  };
}

@Injectable()
export class McpToolsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly accounts: AccountsService,
    private readonly campaigns: CampaignsService,
    private readonly campaignRun: CampaignRunService,
    private readonly conversations: ConversationsService,
    private readonly analytics: AnalyticsService,
    private readonly webhooks: WebhooksService,
  ) {}

  buildServer(principal: ApiKeyPrincipal): McpServer {
    const ws = principal.workspaceId;
    const server = new McpServer({ name: "10xconnect", version: "1.0.0" });

    // --- Read tools (every key) ----------------------------------------------

    server.registerTool(
      "list_accounts",
      {
        description:
          "List the workspace's connected LinkedIn sending accounts with status and health score.",
        inputSchema: {},
      },
      safe(async () => this.accounts.list(ws)),
    );

    server.registerTool(
      "get_account_health",
      {
        description:
          "Safety analytics for one sending account: acceptance rate, action volume vs caps, restriction events, health score.",
        inputSchema: { accountId: z.string().uuid() },
      },
      safe(async ({ accountId }) => this.accounts.health(ws, accountId)),
    );

    server.registerTool(
      "list_campaigns",
      {
        description: "List campaigns with status (draft/running/paused/stopped/completed) and lead counts.",
        inputSchema: {},
      },
      safe(async () => this.campaigns.list(ws)),
    );

    server.registerTool(
      "get_campaign",
      {
        description: "Get one campaign's details (status, sender, settings, lead count).",
        inputSchema: { campaignId: z.string().uuid() },
      },
      safe(async ({ campaignId }) => this.campaigns.detail(ws, campaignId)),
    );

    server.registerTool(
      "get_campaign_analytics",
      {
        description:
          "Campaign performance: connection requests, accepted invites (+%), messages, replies (+%), likes/comments/visits.",
        inputSchema: { campaignId: z.string().uuid() },
      },
      safe(async ({ campaignId }) => this.analytics.campaign(ws, campaignId)),
    );

    server.registerTool(
      "get_workspace_analytics",
      {
        description: "Workspace-level outreach analytics (connections, conversations, engagements).",
        inputSchema: { range: z.enum(["7d", "30d", "all"]).optional() },
      },
      safe(async ({ range }) => this.analytics.workspace(ws, parseAnalyticsRange(range))),
    );

    server.registerTool(
      "search_leads",
      {
        description:
          "Search the workspace's leads/contacts by name, company, headline, email, or LinkedIn URL.",
        inputSchema: {
          query: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      safe(async ({ query, limit }) => this.searchLeads(ws, query, limit)),
    );

    server.registerTool(
      "get_lead",
      {
        description: "Get one lead's full profile (enrichment, tags, LinkedIn URL, email).",
        inputSchema: { leadId: z.string().uuid() },
      },
      safe(async ({ leadId }) => this.getLead(ws, leadId)),
    );

    server.registerTool(
      "list_conversations",
      {
        description:
          "List inbox conversations (unified across sending accounts). Filter: all | reply_required | important.",
        inputSchema: {
          filter: z.enum(["all", "reply_required", "important"]).optional(),
          accountId: z.string().uuid().optional(),
        },
      },
      safe(async ({ filter, accountId }) =>
        this.conversations.list(ws, null, filter ?? "all", accountId),
      ),
    );

    server.registerTool(
      "get_conversation",
      {
        description: "Get one conversation's full message thread + lead panel.",
        inputSchema: { conversationId: z.string().uuid() },
      },
      safe(async ({ conversationId }) => this.conversations.detail(ws, conversationId, null)),
    );

    server.registerTool(
      "list_webhooks",
      {
        description: "List the workspace's outbound webhooks (URL, subscribed events, status).",
        inputSchema: {},
      },
      safe(async () => this.webhooks.list(ws)),
    );

    if (principal.permission === "read_only") {
      return server;
    }

    // --- Mutating tools (permission "all" only) --------------------------------

    server.registerTool(
      "pause_campaign",
      {
        description: "Pause a running campaign (freezes dispatch in place; resumable).",
        inputSchema: { campaignId: z.string().uuid() },
      },
      safe(async ({ campaignId }) => this.campaignRun.pause(ws, campaignId)),
    );

    server.registerTool(
      "resume_campaign",
      {
        description: "Resume a paused campaign — each lead picks up where it stopped.",
        inputSchema: { campaignId: z.string().uuid() },
      },
      safe(async ({ campaignId }) => this.campaignRun.resume(ws, campaignId)),
    );

    server.registerTool(
      "send_reply",
      {
        description:
          "Reply in a conversation. The message is queued through the dispatch engine (idempotent, respects account health) — it does not send instantly.",
        inputSchema: {
          conversationId: z.string().uuid(),
          body: z.string().trim().min(1).max(8000),
        },
      },
      safe(async ({ conversationId, body }) =>
        this.conversations.reply(ws, conversationId, { body }),
      ),
    );

    server.registerTool(
      "create_webhook",
      {
        description: `Create an outbound webhook. Events: ${WEBHOOK_EVENTS.join(", ")}. Returns the signing secret ONCE.`,
        inputSchema: {
          name: z.string().trim().min(1).max(80).optional(),
          url: z.string().url().max(2048),
          events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
        },
      },
      safe(async ({ name, url, events }) => this.webhooks.create(ws, { name, url, events })),
    );

    return server;
  }

  // --- direct reads (no dedicated service method worth importing) -------------

  private async searchLeads(workspaceId: string, query?: string, limit = 25) {
    let q = this.db
      .selectFrom("leads")
      .select(["id", "linkedin_url", "email", "enrichment", "tags", "connection_degree"])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .limit(Math.min(limit, 100));
    if (query && query.trim()) {
      const like = `%${query.trim()}%`;
      q = q.where((eb) =>
        eb.or([
          eb("linkedin_url", "ilike", like),
          eb("email", "ilike", like),
          eb(sql`enrichment::text`, "ilike", like),
        ]),
      );
    }
    const rows = await q.execute();
    return rows.map((r) => this.leadView(r));
  }

  private async getLead(workspaceId: string, leadId: string) {
    const row = await this.db
      .selectFrom("leads")
      .select(["id", "linkedin_url", "email", "enrichment", "tags", "connection_degree"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", leadId)
      .executeTakeFirst();
    if (!row) {
      return { error: "Lead not found" };
    }
    return { ...this.leadView(row), enrichment: row.enrichment };
  }

  private leadView(row: {
    id: string;
    linkedin_url: string | null;
    email: string | null;
    enrichment: unknown;
    tags: string[] | null;
    connection_degree: number | null;
  }) {
    const e =
      row.enrichment && typeof row.enrichment === "object" && !Array.isArray(row.enrichment)
        ? (row.enrichment as Record<string, unknown>)
        : {};
    const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
    return {
      id: row.id,
      name: [str(e.firstName), str(e.lastName)].filter(Boolean).join(" ") || null,
      headline: str(e.headline),
      company: str(e.company),
      role: str(e.role),
      linkedinUrl: row.linkedin_url,
      email: row.email,
      tags: row.tags ?? [],
      connectionDegree: row.connection_degree,
    };
  }
}
