import { env } from "@10xconnect/config";
import type { LeadSourceAdapter } from "@10xconnect/core";

import { MockLeadSourceAdapter } from "./mock-lead-source-adapter";
import { UnipileLeadSourceAdapter } from "./unipile-lead-source-adapter";

export type LeadSourceAdapterKind = "mock" | "unipile";

/** The lead-source adapter selected by ADAPTER (defaults to 'mock'), like §5/§8. */
export function resolveLeadSourceAdapterKind(): LeadSourceAdapterKind {
  return env.ADAPTER;
}

/**
 * Resolve the LeadSourceAdapter the import engine should use. Mirrors
 * createChannelAdapter: mock by default; ADAPTER=unipile selects the (currently
 * stubbed) real sourcing transport, which requires UNIPILE_API_KEY + UNIPILE_DSN.
 */
export function createLeadSourceAdapter(
  kind: LeadSourceAdapterKind = resolveLeadSourceAdapterKind(),
): LeadSourceAdapter {
  switch (kind) {
    case "mock":
      return new MockLeadSourceAdapter();
    case "unipile":
      if (!env.UNIPILE_API_KEY || !env.UNIPILE_DSN) {
        throw new Error("ADAPTER=unipile requires UNIPILE_API_KEY and UNIPILE_DSN");
      }
      return new UnipileLeadSourceAdapter({
        apiKey: env.UNIPILE_API_KEY,
        dsn: env.UNIPILE_DSN,
      });
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown ADAPTER: ${String(exhaustive)}`);
    }
  }
}
