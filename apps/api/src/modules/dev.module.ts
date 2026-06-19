import { randomUUID } from "node:crypto";

import { env } from "@10xconnect/config";
import type { InboundEvent } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { processInboundEvent } from "@10xconnect/engine";
import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// Dev-only tools for rehearsing the loop on the MOCK adapter (simulate the
// inbound events that, in production, arrive via the Unipile webhook). Disabled
// when NODE_ENV=production. NOT a transport bypass — it injects the SAME
// InboundEvent shape the real webhook produces.

const simulateSchema = z.object({
  type: z.enum(["reply", "invite_accepted", "message_opened", "restriction"]),
  leadId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  body: z.string().max(2000).optional(),
});
type SimulateDto = z.infer<typeof simulateSchema>;

@Injectable()
export class DevService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async simulate(workspaceId: string, dto: SimulateDto): Promise<{ status: string }> {
    if (env.NODE_ENV === "production") {
      throw new ForbiddenException("Dev tools are disabled in production.");
    }

    const accountId =
      dto.accountId ??
      (
        await this.db
          .selectFrom("sending_accounts")
          .select("id")
          .where("workspace_id", "=", workspaceId)
          .orderBy("created_at", "asc")
          .executeTakeFirst()
      )?.id;
    if (!accountId) {
      throw new NotFoundException("No sending account to simulate against.");
    }

    const base = {
      id: `dev-${randomUUID()}`,
      accountId,
      channel: "linkedin" as const,
      occurredAt: new Date().toISOString(),
    };

    let event: InboundEvent;
    if (dto.type === "restriction") {
      event = { ...base, type: "account_status_changed", status: "restricted" };
    } else if (!dto.leadId) {
      throw new NotFoundException("leadId is required for this event.");
    } else if (dto.type === "reply") {
      event = {
        ...base,
        type: "reply",
        lead: { leadId: dto.leadId },
        message: {
          direction: "inbound",
          channel: "linkedin",
          body: dto.body ?? "Sounds interesting — tell me more!",
          sentAt: base.occurredAt,
        },
      };
    } else if (dto.type === "invite_accepted") {
      event = { ...base, type: "invite_accepted", lead: { leadId: dto.leadId } };
    } else {
      event = { ...base, type: "message_opened", lead: { leadId: dto.leadId } };
    }

    const res = await processInboundEvent({ db: this.db }, event);
    return { status: res.status };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("dev")
export class DevController {
  constructor(private readonly dev: DevService) {}

  @Post("simulate")
  simulate(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(simulateSchema)) body: SimulateDto,
  ) {
    return this.dev.simulate(workspaceId, body);
  }
}

@Module({
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
