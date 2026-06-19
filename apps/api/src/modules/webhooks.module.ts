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
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { Public } from "../common/decorators/public.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

const WEBHOOK_EVENTS = ["reply", "accepted_invite", "status_change"] as const;

const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
type CreateWebhookDto = z.infer<typeof createWebhookSchema>;

@Injectable()
export class WebhooksService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  list(workspaceId: string) {
    return this.db
      .selectFrom("webhooks")
      .select(["id", "url", "events", "created_at as createdAt"])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
  }

  create(workspaceId: string, dto: CreateWebhookDto) {
    return this.db
      .insertInto("webhooks")
      .values({ workspace_id: workspaceId, url: dto.url, events: dto.events })
      .returning(["id", "url", "events", "created_at as createdAt"])
      .executeTakeFirstOrThrow();
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

  @Post()
  create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createWebhookSchema)) body: CreateWebhookDto,
  ) {
    return this.webhooks.create(workspaceId, body);
  }

  @Delete(":id")
  remove(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.webhooks.remove(workspaceId, id);
  }
}

// Inbound receivers from external services — public.
@Controller("webhooks")
export class InboundWebhooksController {
  private readonly logger = new Logger("InboundWebhooks");

  // Injected as `unknown` and narrowed by isInboundWebhookReceiver, so no provider
  // types cross into the app layer. The mock adapter does not ingest webhooks.
  constructor(@Inject(CHANNEL_ADAPTER) private readonly adapter: unknown) {}

  @Public()
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

  @Public()
  @Post("payments")
  payments(): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [WebhooksController, InboundWebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
