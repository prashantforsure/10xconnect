import type { DB } from "@10xconnect/db";
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// Display-only billing for the MVP: real Creem/Dodo checkout is deferred. Pricing
// mirrors the marketing pages (per sending-account slot; everything else free).
const PRICE_PER_SLOT = { monthly: 49, annual: 39 } as const;
type Cycle = keyof typeof PRICE_PER_SLOT;

const slotsSchema = z.object({
  slotCount: z.number().int().min(1).max(100),
  cycle: z.enum(["monthly", "annual"]).optional(),
});
type SlotsDto = z.infer<typeof slotsSchema>;

const checkoutSchema = z.object({ cycle: z.enum(["monthly", "annual"]) });
type CheckoutDto = z.infer<typeof checkoutSchema>;

@Injectable()
export class BillingService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /** Ensure a subscriptions row exists (free/not_activated) and return the view. */
  async subscription(workspaceId: string) {
    let row = await this.db
      .selectFrom("subscriptions")
      .select(["slot_count", "plan", "billing_cycle", "status"])
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirst();

    if (!row) {
      const activeAccounts = await this.db
        .selectFrom("sending_accounts")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirstOrThrow();
      const slotCount = Math.max(1, Number(activeAccounts.count));
      row = await this.db
        .insertInto("subscriptions")
        .values({
          workspace_id: workspaceId,
          slot_count: slotCount,
          billing_cycle: "annual",
          status: "not_activated",
        })
        .returning(["slot_count", "plan", "billing_cycle", "status"])
        .executeTakeFirstOrThrow();
    }

    const cycle = (row.billing_cycle ?? "annual") as Cycle;
    const slots = row.slot_count;
    return {
      status: row.status,
      plan: row.plan ?? "per_slot",
      slotCount: slots,
      billingCycle: cycle,
      pricePerSlot: PRICE_PER_SLOT[cycle],
      monthlyCost: slots * PRICE_PER_SLOT[cycle],
      activeSlots: slots,
      freeSlots: 0,
    };
  }

  async setSlots(workspaceId: string, dto: SlotsDto) {
    await this.subscription(workspaceId); // ensure a row exists
    await this.db
      .updateTable("subscriptions")
      .set({
        slot_count: dto.slotCount,
        ...(dto.cycle ? { billing_cycle: dto.cycle } : {}),
      })
      .where("workspace_id", "=", workspaceId)
      .execute();
    return this.subscription(workspaceId);
  }

  checkout(_workspaceId: string, dto: CheckoutDto) {
    // Display-only: a real Creem/Dodo checkout session lands in a later step.
    return {
      status: "not_available" as const,
      message: `Checkout (${dto.cycle}) is not wired in this MVP. Configure a payment provider to enable it.`,
    };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("subscription")
  subscription(@WorkspaceId() workspaceId: string) {
    return this.billing.subscription(workspaceId);
  }

  @Post("slots")
  slots(@WorkspaceId() workspaceId: string, @Body(new ZodValidationPipe(slotsSchema)) body: SlotsDto) {
    return this.billing.setSlots(workspaceId, body);
  }

  @Post("checkout")
  checkout(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutDto,
  ) {
    return this.billing.checkout(workspaceId, body);
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
