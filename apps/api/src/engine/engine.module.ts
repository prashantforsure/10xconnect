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
  ) {}

  onModuleInit(): void {
    this.adapter.subscribeInboundEvents((event) => {
      void processInboundEvent({ db: this.db, log: (m) => this.logger.log(m) }, event).catch((err) =>
        this.logger.error(`inbound processing failed: ${String(err)}`),
      );
    });
    this.logger.log("Subscribed to inbound transport events.");
  }
}

@Global()
@Module({
  providers: [engineDepsProvider, InboundEventsService],
  exports: [ENGINE_DEPS],
})
export class EngineModule {}
