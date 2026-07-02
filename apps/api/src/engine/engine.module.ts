import type { ChannelAdapter } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  type EngineDeps,
  dispatchConfigFromEnv,
  processInboundEvent,
} from "@10xconnect/engine";
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { KYSELY_DB } from "../database/database.module";
import { AccountsModule, AccountsService } from "../modules/accounts.module";

/** DI token for the shared engine dependencies (db + adapter + dispatch config). */
export const ENGINE_DEPS = "ENGINE_DEPS";

const engineDepsProvider = {
  provide: ENGINE_DEPS,
  inject: [KYSELY_DB, CHANNEL_ADAPTER],
  useFactory: (db: Kysely<DB>, adapter: ChannelAdapter): EngineDeps => ({
    db,
    adapter,
    config: dispatchConfigFromEnv(),
    log: (msg: string) => new Logger("Engine").log(msg),
  }),
};

/**
 * Subscribes to inbound transport events (real Unipile webhooks via the inbound
 * route, or mock simulate hooks) and routes them through the engine: a reply
 * auto-stops the lead + lands in the inbox; a restriction auto-pauses the account
 * (CLAUDE.md §2). Runs in the API process (where the webhook + adapter live).
 */
@Injectable()
export class InboundEventsService implements OnModuleInit {
  private readonly logger = new Logger(InboundEventsService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: ChannelAdapter,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.adapter.subscribeInboundEvents((event) => {
      void processInboundEvent({ db: this.db, log: (m) => this.logger.log(m) }, event)
        .then((result) => this.afterProcess(event, result.status))
        .catch((err) => this.logger.error(`inbound processing failed: ${String(err)}`));
    });
    this.logger.log("Subscribed to inbound transport events.");
  }

  /**
   * Infinite login (CLAUDE.md §6): when a credentials account's session drops
   * (Unipile CREDENTIALS → 'restricted', or a disconnect), silently re-authenticate
   * it. Gated on `processed` so it runs at most once per drop (a replayed webhook is
   * a 'duplicate' → no-op) — no reconnect loop. A non-credentials account is a
   * no-op inside the service, so the existing restriction → auto-pause still stands.
   */
  private async afterProcess(
    event: Parameters<typeof processInboundEvent>[1],
    status: "processed" | "duplicate" | "unresolved",
  ): Promise<void> {
    if (
      status === "processed" &&
      event.type === "account_status_changed" &&
      (event.status === "restricted" || event.status === "disconnected")
    ) {
      await this.accounts
        .attemptInfiniteReconnectByRef(event.accountId)
        .catch((err) => this.logger.warn(`infinite-login reconnect errored: ${String(err)}`));
    }
  }
}

@Global()
@Module({
  imports: [AccountsModule],
  providers: [engineDepsProvider, InboundEventsService],
  exports: [ENGINE_DEPS],
})
export class EngineModule {}
