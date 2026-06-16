import { isInboundWebhookReceiver } from "@10xconnect/adapters";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotImplementedException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { Public } from "../common/decorators/public.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class WebhooksService {}

// Outbound webhook config — workspace-scoped.
@UseGuards(WorkspaceScopeGuard)
@Controller("webhooks")
export class WebhooksController {
  @Get()
  list(): never {
    throw new NotImplementedException();
  }

  @Post()
  create(): never {
    throw new NotImplementedException();
  }

  @Delete(":id")
  remove(@Param("id") _id: string): never {
    throw new NotImplementedException();
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
