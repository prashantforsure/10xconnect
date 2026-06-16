import { createChannelAdapter, resolveAdapterKind } from "@10xconnect/adapters";
import type { ChannelAdapter } from "@10xconnect/core";
import { Global, Logger, Module } from "@nestjs/common";

/** DI token for the resolved ChannelAdapter (mock by default; see ADAPTER env). */
export const CHANNEL_ADAPTER = "CHANNEL_ADAPTER";

@Global()
@Module({
  providers: [
    {
      provide: CHANNEL_ADAPTER,
      useFactory: (): ChannelAdapter => {
        const kind = resolveAdapterKind();
        const logger = new Logger("ChannelAdapter");
        logger.log(`Resolved channel adapter: ${kind}`);
        const adapter = createChannelAdapter(kind);
        // Observe normalized inbound events end-to-end (no PII/secrets — type + ids
        // only). The orchestration consumer (auto-stop / inbox) lands in Phase 4.
        adapter.subscribeInboundEvents((event) => {
          logger.log(`Inbound event: ${event.type} account=${event.accountId} id=${event.id}`);
        });
        return adapter;
      },
    },
  ],
  exports: [CHANNEL_ADAPTER],
})
export class ChannelAdapterModule {}
