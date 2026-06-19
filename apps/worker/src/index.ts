import { createChannelAdapter, createTextAdapter, resolveAdapterKind } from "@10xconnect/adapters";
import { env } from "@10xconnect/config";
import { createDb } from "@10xconnect/db";
import {
  createAiResolver,
  type DispatchStats,
  type EngineDeps,
  dispatchConfigFromEnv,
  dispatchDueActions,
} from "@10xconnect/engine";

/**
 * Dispatch worker (CLAUDE.md §5 "the brain"). Each tick it pulls due actions from
 * the `actions` table, enforces the rate governor + scheduler + warm-up, executes
 * via the ChannelAdapter (mock by default; Unipile when ADAPTER=unipile), records
 * results idempotently, and advances each lead's sequence. The DB is the durable
 * queue — no Redis required for the MVP (BullMQ is a future swap behind the same
 * seam). Inbound webhooks are handled by the API process, not here.
 */
function main(): void {
  console.log(`worker up (${env.NODE_ENV})`);

  const adapterKind = resolveAdapterKind();
  const adapter = createChannelAdapter(adapterKind);
  console.log(`worker channel adapter: ${adapterKind}`);

  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL is required for the dispatch worker. Idling.");
    keepAlive();
    return;
  }
  if (!env.DISPATCH_ENABLED) {
    console.log("DISPATCH_ENABLED=false — worker is idle (no dispatching).");
    keepAlive();
    return;
  }

  const db = createDb();
  const textAdapter = createTextAdapter();
  console.log(`AI personalization: ${textAdapter ? `on (${env.LLM_PROVIDER}/${env.LLM_MODEL})` : "off (no LLM_API_KEY)"}`);
  const deps: EngineDeps = {
    db,
    adapter,
    config: dispatchConfigFromEnv(),
    resolveContent: createAiResolver(textAdapter),
    log: (msg) => console.log(`[dispatch] ${msg}`),
  };
  console.log(
    `dispatch cadence: tick=${env.DISPATCH_TICK_MS}ms spacing=${deps.config.minSpacingMs}ms ` +
      `jitter=${deps.config.jitterMs}ms ignoreWorkingHours=${deps.config.ignoreWorkingHours}`,
  );

  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) {
      return; // never overlap ticks
    }
    ticking = true;
    try {
      const stats: DispatchStats = await dispatchDueActions(deps);
      if (stats.claimed > 0) {
        console.log(`[dispatch] ${JSON.stringify(stats)}`);
      }
    } catch (err) {
      console.error("[dispatch] tick failed:", err instanceof Error ? err.message : err);
    } finally {
      ticking = false;
    }
  };

  setInterval(() => void tick(), env.DISPATCH_TICK_MS);
  void tick();
}

function keepAlive(): void {
  setInterval(() => {
    // Idle heartbeat.
  }, 60_000);
}

main();
