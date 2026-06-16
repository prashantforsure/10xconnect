import { env } from "@10xconnect/config";
import type { ChannelAdapter } from "@10xconnect/core";

import { MockChannelAdapter } from "./mock";
import { UnipileChannelAdapter } from "./unipile";

export type AdapterKind = "mock" | "unipile";

/** The adapter selected by the ADAPTER env var (defaults to 'mock'). */
export function resolveAdapterKind(): AdapterKind {
  return env.ADAPTER;
}

/**
 * Resolve the ChannelAdapter the app/worker should use. Defaults to the mock
 * adapter for dev/test; ADAPTER=unipile selects the real Unipile transport
 * (requires UNIPILE_API_KEY + UNIPILE_DSN, server-side only).
 */
export function createChannelAdapter(kind: AdapterKind = resolveAdapterKind()): ChannelAdapter {
  switch (kind) {
    case "mock":
      return new MockChannelAdapter();
    case "unipile":
      if (!env.UNIPILE_API_KEY || !env.UNIPILE_DSN) {
        throw new Error("ADAPTER=unipile requires UNIPILE_API_KEY and UNIPILE_DSN");
      }
      return new UnipileChannelAdapter({ apiKey: env.UNIPILE_API_KEY, dsn: env.UNIPILE_DSN });
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown ADAPTER: ${String(exhaustive)}`);
    }
  }
}
