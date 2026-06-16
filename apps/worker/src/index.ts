import { createChannelAdapter, resolveAdapterKind } from "@10xconnect/adapters";
import { env } from "@10xconnect/config";

/**
 * Worker entry point. In later phases this process hosts BullMQ consumers for the
 * dispatch engine (rate governor, scheduler, sequence engine). For now it boots,
 * resolves the transport adapter (mock by default), and idles.
 */
function main(): void {
  console.log("worker up");
  console.log(`worker environment: ${env.NODE_ENV}`);

  // Resolve the ChannelAdapter the dispatch engine will use (ADAPTER env → mock by default).
  const adapterKind = resolveAdapterKind();
  createChannelAdapter(adapterKind);
  console.log(`worker channel adapter: ${adapterKind}`);

  // Keep the process alive. BullMQ consumers will replace this heartbeat later.
  setInterval(() => {
    // Intentionally empty: idle heartbeat placeholder.
  }, 60_000);
}

main();
