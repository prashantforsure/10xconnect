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
        new Logger("ChannelAdapter").log(`Resolved channel adapter: ${kind}`);
        return createChannelAdapter(kind);
      },
    },
  ],
  exports: [CHANNEL_ADAPTER],
})
export class ChannelAdapterModule {}
