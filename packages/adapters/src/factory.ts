import { env } from "@10xconnect/config";
import type { ChannelAdapter } from "@10xconnect/core";

import { MockChannelAdapter } from "./mock";

export type AdapterKind = "mock" | "unipile";

/** The adapter selected by the ADAPTER env var (defaults to 'mock'). */
export function resolveAdapterKind(): AdapterKind {
  return env.ADAPTER;
}

/**
 * Resolve the ChannelAdapter the app/worker should use. Defaults to the mock
 * adapter for dev/test; the real Unipile adapter is wired in a later step.
 */
export function createChannelAdapter(kind: AdapterKind = resolveAdapterKind()): ChannelAdapter {
  switch (kind) {
    case "mock":
      return new MockChannelAdapter();
    case "unipile":
      throw new Error(
        "Unipile ChannelAdapter is not implemented yet. Set ADAPTER=mock for dev/test.",
      );
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown ADAPTER: ${String(exhaustive)}`);
    }
  }
}
