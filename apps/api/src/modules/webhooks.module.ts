import { randomBytes } from "node:crypto";

import { isInboundWebhookReceiver } from "@10xconnect/adapters";
import type { DB } from "@10xconnect/db";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Kysely } from "kysely";
import { z } from "zod";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { SecretCipher } from "../common/crypto/secret-cipher";
import { Public } from "../common/decorators/public.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WebhookSecretGuard } from "../common/guards/webhook-secret.guard";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

import { DeliveryService } from "./integrations/delivery.service";
import { sendWebhook, type EventEnvelope } from "./integrations/webhook-sender";

export const WEBHOOK_EVENTS = [
  "reply",
  "accepted_invite",
  "status_change",
  "hot_lead",
  "campaign_completed",
  "message_sent",
] as const;

const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  authHeaderName: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9-]{1,64}$/, "Invalid header name")
    .optional(),
  authHeaderValue: z.string().min(1).max(2048).optional(),
});
type CreateWebhookDto = z.infer<typeof createWebhookSchema>;

const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;

const WEBHOOK_VIEW_COLUMNS = [
  "id",
  "name",
  "url",
  "events",
  "status",
  "auth_header_name as authHeaderName",
  "consecutive_failures as consecutiveFailures",
  "created_at as createdAt",
] as const;

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly cipher: SecretCipher,
  ) {}

  list(workspaceId: string) {
    return this.db
      .selectFrom("webhooks")
      .select([...WEBHOOK_VIEW_COLUMNS])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
  }

  /**
   * Create a webhook and return its signing secret ONCE (like API keys). The
   * optional custom auth header value is encrypted at rest.
   */
  async create(workspaceId: string, dto: CreateWebhookDto) {
    const secret = `whsec_${randomBytes(16).toString("hex")}`;
    const row = await this.db
      .insertInto("webhooks")
      .values({
        workspace_id: workspaceId,
        name: dto.name ?? "Webhook",
        url: dto.url,
        events: dto.events,
        secret,
        auth_header_name: dto.authHeaderName ?? null,
        auth_header_value:
          dto.authHeaderName && dto.authHeaderValue
            ? this.cipher.encrypt(dto.authHeaderValue)
            : null,
      })
      .returning([...WEBHOOK_VIEW_COLUMNS])
      .executeTakeFirstOrThrow();
    return { ...row, secret };
  }

  async update(workspaceId: string, id: string, dto: UpdateWebhookDto) {
    const updated = await this.db
      .updateTable("webhooks")
      .set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.url ? { url: dto.url } : {}),
        ...(dto.events ? { events: dto.events } : {}),
        // Re-enabling resets the failure streak so it gets a clean run.
        ...(dto.status ? { status: dto.status, consecutive_failures: 0 } : {}),
      })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning([...WEBHOOK_VIEW_COLUMNS])
      .executeTakeFirst();
    if (!updated) {
      throw new NotFoundException("Webhook not found");
    }
    return updated;
  }

  async remove(workspaceId: string, id: string): Promise<{ removed: true }> {
    const deleted = await this.db
      .deleteFrom("webhooks")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Webhook not found");
    }
    return { removed: true };
  }

  /** Recent delivery attempts for one webhook (the settings-page log). */
  async deliveries(workspaceId: string, id: string) {
    const hook = await this.db
      .selectFrom("webhooks")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!hook) {
      throw new NotFoundException("Webhook not found");
    }
    return this.db
      .selectFrom("webhook_deliveries")
      .select([
        "id",
        "event_type as eventType",
        "attempt",
        "status",
        "response_code as responseCode",
        "error",
        "next_attempt_at as nextAttemptAt",
        "delivered_at as deliveredAt",
        "created_at as createdAt",
      ])
      .where("webhook_id", "=", id)
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();
  }

  /**
   * Fire a synthetic sample event at the webhook RIGHT NOW (no outbox), signed
   * with its real secret — lets users verify their receiver end-to-end.
   */
  async sendTest(workspaceId: string, id: string) {
    const hook = await this.db
      .selectFrom("webhooks")
      .select(["id", "url", "secret", "auth_header_name", "auth_header_value", "events"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!hook) {
      throw new NotFoundException("Webhook not found");
    }
    let authHeaderValue: string | null = null;
    if (hook.auth_header_name && hook.auth_header_value) {
      try {
        authHeaderValue = this.cipher.decrypt(hook.auth_header_value);
      } catch {
        // send without the header rather than failing the test outright
      }
    }
    const type = hook.events[0] ?? "reply";
    const envelope: EventEnvelope = {
      id: `evt_test_${randomBytes(8).toString("hex")}`,
      type,
      created_at: new Date().toISOString(),
      workspace_id: workspaceId,
      data: {
        test: true,
        lead: { id: "lead_test", name: "Test Lead", linkedin_url: "https://linkedin.com/in/test" },
        message: { body: "This is a test delivery from 10xConnect." },
      },
    };
    const result = await sendWebhook(
      {
        url: hook.url,
        secret: hook.secret,
        authHeaderName: hook.auth_header_name,
        authHeaderValue,
      },
      envelope,
      { deliveryId: `test_${hook.id}` },
    );
    return { ok: result.ok, status: result.status ?? null, error: result.error ?? null };
  }
}

// Outbound webhook config — workspace-scoped.
@UseGuards(WorkspaceScopeGuard)
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string) {
    return this.webhooks.list(workspaceId);
  }

  @Get("events")
  events() {
    return { events: WEBHOOK_EVENTS };
  }

  @Post()
  create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createWebhookSchema)) body: CreateWebhookDto,
  ) {
    return this.webhooks.create(workspaceId, body);
  }

  @Patch(":id")
  update(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: UpdateWebhookDto,
  ) {
    return this.webhooks.update(workspaceId, id, body);
  }

  @Get(":id/deliveries")
  deliveries(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.webhooks.deliveries(workspaceId, id);
  }

  @Post(":id/test")
  test(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.webhooks.sendTest(workspaceId, id);
  }

  @Delete(":id")
  remove(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.webhooks.remove(workspaceId, id);
  }
}

// Inbound receivers from external services — public, secret-authenticated, and
// exempt from rate limiting (provider retries must never be throttled).
@Public()
@SkipThrottle()
@UseGuards(WebhookSecretGuard)
@Controller("webhooks")
export class InboundWebhooksController {
  private readonly logger = new Logger("InboundWebhooks");

  // Injected as `unknown` and narrowed by isInboundWebhookReceiver, so no provider
  // types cross into the app layer. The mock adapter does not ingest webhooks.
  constructor(@Inject(CHANNEL_ADAPTER) private readonly adapter: unknown) {}

  @Post("inbound/unipile")
  async unipile(@Body() body: unknown): Promise<{ received: true }> {
    if (isInboundWebhookReceiver(this.adapter)) {
      await this.adapter.ingestWebhook(body);
    } else {
      this.logger.warn("Unipile webhook received but the active adapter does not ingest webhooks");
    }
    // Always 200 quickly so Unipile does not retry (it expects 200 within 30s).
    return { received: true };
  }

  @Post("payments")
  payments(): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [WebhooksController, InboundWebhooksController],
  providers: [WebhooksService, SecretCipher, DeliveryService],
  exports: [DeliveryService, WebhooksService],
})
export class WebhooksModule {}
