import {
  createChannelAdapter,
  createEmbeddingAdapter,
  createTextAdapter,
  resolveAdapterKind,
} from "@10xconnect/adapters";
import { assertProductionEnv, env } from "@10xconnect/config";
import { createAttachmentUrlResolver, createDb } from "@10xconnect/db";
import {
  createCachedAiResolver,
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
  // Fail fast in production if critical secrets are missing (no-op in dev/test).
  // "worker": no HTTP surface, so it does NOT require SUPABASE_JWT_SECRET (API-only).
  assertProductionEnv("worker");
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
  const embeddingAdapter = createEmbeddingAdapter();
  console.log(`AI personalization: ${textAdapter ? `on (${env.LLM_PROVIDER}/${env.LLM_MODEL})` : "off (no LLM_API_KEY)"}`);
  console.log(`conversation brain: ${textAdapter && embeddingAdapter ? `on (embeds=${env.EMBEDDING_PROVIDER})` : "off (needs LLM + embeddings)"}`);
  // Fresh signed URLs for message attachments at dispatch (stored ones expire).
  const resolveAttachmentUrl = createAttachmentUrlResolver();
  const deps: EngineDeps = {
    db,
    adapter,
    config: dispatchConfigFromEnv(),
    textAdapter,
    embeddingAdapter,
    ...(resolveAttachmentUrl ? { resolveAttachmentUrl } : {}),
    // Model id for Phase 3 cost metering (mock is priced so the governor works offline).
    modelLabel: env.LLM_PROVIDER === "mock" ? "mock" : env.LLM_MODEL,
    log: (msg) => console.log(`[dispatch] ${msg}`),
  };
  // Phase 5: cache-aware resolver reuses the per-prospect preview (no 2nd LLM call).
  deps.resolveContent = createCachedAiResolver(deps);
  console.log(
    `dispatch cadence: mode=${env.DISPATCH_MODE} tick=${env.DISPATCH_TICK_MS}ms ` +
      `spacing=${deps.config.minSpacingMs}ms jitter=${deps.config.jitterMs}ms ` +
      `ignoreWorkingHours=${deps.config.ignoreWorkingHours} ` +
      `aiReplyDelay=${deps.config.aiReplyMinDelayMs}ms+${deps.config.aiReplyJitterMs}ms`,
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

  const timer = setInterval(() => void tick(), env.DISPATCH_TICK_MS);
  void tick();
  installGracefulShutdown(timer);
}

function keepAlive(): void {
  setInterval(() => {
    // Idle heartbeat.
  }, 60_000);
}

/** Stop claiming new work on SIGTERM/SIGINT, let an in-flight tick drain, then exit. */
function installGracefulShutdown(timer: NodeJS.Timeout): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`worker received ${signal} — draining and shutting down`);
    clearInterval(timer);
    // Give an in-flight tick a moment to finish before exiting.
    setTimeout(() => process.exit(0), 3_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
