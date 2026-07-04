import { env } from "@10xconnect/config";
import type { DB } from "@10xconnect/db";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { SecretCipher } from "../common/crypto/secret-cipher";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

import { formatSlackMessage } from "./integrations/slack-format";
import { postSlack, type EventEnvelope } from "./integrations/webhook-sender";
import { WEBHOOK_EVENTS } from "./webhooks.module";

// The catalog shown on /settings/integrations. `kind` drives the card UI:
//  - connection : has a real per-workspace connect flow (Slack today)
//  - automation : rides on the public API + webhooks (docs deep-link)
//  - soon       : on the roadmap, not connectable yet
const PROVIDERS = [
  { id: "slack", name: "Slack", category: "Alerts", kind: "connection" },
  { id: "zapier", name: "Zapier", category: "Automation", kind: "automation" },
  { id: "n8n", name: "n8n", category: "Automation", kind: "automation" },
  { id: "make", name: "Make", category: "Automation", kind: "automation" },
  { id: "clay", name: "Clay", category: "Automation", kind: "automation" },
  { id: "mcp", name: "MCP server", category: "AI", kind: "automation" },
  { id: "hubspot", name: "HubSpot", category: "CRM", kind: "soon" },
  { id: "salesforce", name: "Salesforce", category: "CRM", kind: "soon" },
  { id: "pipedrive", name: "Pipedrive", category: "CRM", kind: "soon" },
  { id: "calendly", name: "Calendly", category: "Calendar", kind: "soon" },
  { id: "calcom", name: "Cal.com", category: "Calendar", kind: "soon" },
] as const;

// Production requires a genuine Slack incoming-webhook host; dev/self-host/e2e
// accept any valid https(+http-in-dev) URL so a local sink or a Slack-compatible
// endpoint (Mattermost, etc.) can be pointed at the connector for testing.
const slackWebhookUrl =
  env.NODE_ENV === "production"
    ? z.string().url().regex(/^https:\/\/hooks\.slack\.com\//, "Must be a Slack incoming-webhook URL")
    : z.string().url();

const connectSlackSchema = z.object({
  webhookUrl: slackWebhookUrl,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
type ConnectSlackDto = z.infer<typeof connectSlackSchema>;

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly cipher: SecretCipher,
  ) {}

  /** Catalog + live connected state from integration_connections. */
  async list(workspaceId: string) {
    const connections = await this.db
      .selectFrom("integration_connections")
      .select(["provider", "status", "events", "created_at as createdAt"])
      .where("workspace_id", "=", workspaceId)
      .execute();
    const byProvider = new Map(connections.map((c) => [c.provider as string, c]));
    return PROVIDERS.map((p) => {
      const connection = byProvider.get(p.id);
      return {
        ...p,
        connected: connection?.status === "active",
        events: connection?.events ?? [],
        status: connection?.status ?? null,
      };
    });
  }

  /** Connect (or reconfigure) Slack: encrypt the webhook URL, upsert, welcome-post. */
  async connectSlack(workspaceId: string, dto: ConnectSlackDto) {
    const config = { webhook_url_enc: this.cipher.encrypt(dto.webhookUrl) };
    await this.db
      .insertInto("integration_connections")
      .values({
        workspace_id: workspaceId,
        provider: "slack",
        status: "active",
        config: JSON.stringify(config),
        events: dto.events,
      })
      .onConflict((oc) =>
        oc.columns(["workspace_id", "provider"]).doUpdateSet({
          status: "active",
          config: JSON.stringify(config),
          events: dto.events,
          updated_at: new Date().toISOString(),
        }),
      )
      .execute();

    // Welcome message — also validates the pasted URL end-to-end right away.
    const hello = await postSlack(dto.webhookUrl, {
      text: "✅ 10xConnect connected",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *10xConnect connected.* This channel will now receive: ${dto.events.join(", ")}.`,
          },
        },
      ],
    });
    return { connected: true, welcomeDelivered: hello.ok };
  }

  /** Fire a sample event at the connected Slack channel. */
  async testSlack(workspaceId: string) {
    const connection = await this.db
      .selectFrom("integration_connections")
      .select(["config", "status"])
      .where("workspace_id", "=", workspaceId)
      .where("provider", "=", "slack")
      .executeTakeFirst();
    if (!connection || connection.status !== "active") {
      throw new NotFoundException("Slack is not connected");
    }
    const config = (connection.config ?? {}) as { webhook_url_enc?: string };
    if (!config.webhook_url_enc) {
      throw new NotFoundException("Slack is not connected");
    }
    const envelope: EventEnvelope = {
      id: `evt_test_slack`,
      type: "reply",
      created_at: new Date().toISOString(),
      workspace_id: workspaceId,
      data: {
        test: true,
        lead: { id: "lead_test", name: "Test Lead", linkedin_url: "https://linkedin.com/in/test" },
        message: { body: "This is a test notification from 10xConnect." },
      },
    };
    const result = await postSlack(
      this.cipher.decrypt(config.webhook_url_enc),
      formatSlackMessage(envelope),
    );
    return { ok: result.ok, status: result.status ?? null, error: result.error ?? null };
  }

  async disconnectSlack(workspaceId: string): Promise<{ disconnected: true }> {
    const deleted = await this.db
      .deleteFrom("integration_connections")
      .where("workspace_id", "=", workspaceId)
      .where("provider", "=", "slack")
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Slack is not connected");
    }
    return { disconnected: true };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string) {
    return this.integrations.list(workspaceId);
  }

  @Post("slack")
  connectSlack(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(connectSlackSchema)) body: ConnectSlackDto,
  ) {
    return this.integrations.connectSlack(workspaceId, body);
  }

  @Post("slack/test")
  testSlack(@WorkspaceId() workspaceId: string) {
    return this.integrations.testSlack(workspaceId);
  }

  @Delete("slack")
  disconnectSlack(@WorkspaceId() workspaceId: string) {
    return this.integrations.disconnectSlack(workspaceId);
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("affiliate")
export class AffiliateController {
  @Get()
  dashboard(@WorkspaceId() workspaceId: string) {
    const code = workspaceId.slice(0, 8);
    return {
      referralCode: code,
      referralUrl: `${env.APP_URL}/signup?ref=${code}`,
      stats: { clicks: 0, signups: 0, earningsUsd: 0 },
      payoutRatePct: 30,
    };
  }
}

@Module({
  controllers: [IntegrationsController, AffiliateController],
  providers: [IntegrationsService, SecretCipher],
})
export class IntegrationsModule {}
