import { env } from "@10xconnect/config";

import type { DispatchConfig } from "./types";

/** Build the dispatch cadence config from validated env (default-safe). */
export function dispatchConfigFromEnv(): DispatchConfig {
  return {
    minSpacingMs: env.DISPATCH_MIN_SPACING_MS,
    jitterMs: env.DISPATCH_JITTER_MS,
    ignoreWorkingHours: env.DISPATCH_IGNORE_WORKING_HOURS,
    batchSize: 25,
  };
}
