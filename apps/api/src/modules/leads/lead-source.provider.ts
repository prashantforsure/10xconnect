import { createLeadSourceAdapter, resolveLeadSourceAdapterKind } from "@10xconnect/adapters";
import type { LeadSourceAdapter } from "@10xconnect/core";
import { Logger, type Provider } from "@nestjs/common";

/** DI token for the resolved LeadSourceAdapter (mock by default; see ADAPTER env). */
export const LEAD_SOURCE_ADAPTER = "LEAD_SOURCE_ADAPTER";

/**
 * Provides the LeadSourceAdapter the import engine uses. Mirrors the
 * ChannelAdapter provider: mock by default, Unipile (stubbed) when ADAPTER=unipile.
 */
export const leadSourceAdapterProvider: Provider = {
  provide: LEAD_SOURCE_ADAPTER,
  useFactory: (): LeadSourceAdapter => {
    const kind = resolveLeadSourceAdapterKind();
    new Logger("LeadSourceAdapter").log(`Resolved lead-source adapter: ${kind}`);
    return createLeadSourceAdapter(kind);
  },
};
