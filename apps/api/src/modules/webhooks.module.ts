import {
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotImplementedException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

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

// Inbound receivers from external services — public (verified by signature later).
@Controller("webhooks")
export class InboundWebhooksController {
  @Public()
  @Post("inbound/unipile")
  unipile(): never {
    throw new NotImplementedException();
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
