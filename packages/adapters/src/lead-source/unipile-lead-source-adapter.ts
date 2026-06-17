import type {
  LeadSourceAccountRef,
  LeadSourceAdapter,
  LeadSourceQuery,
  LeadSourceResult,
} from "@10xconnect/core";

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ STUB — for the Phase 2 (transport) tab to implement.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Real LinkedIn lead sourcing over Unipile (search / sales-navigator / event /
 * post engagement / group / lead-finder), behind the LeadSourceAdapter contract
 * (packages/core). Phase 3 develops entirely against MockLeadSourceAdapter; this
 * class exists so the factory can select `unipile` once the transport is wired.
 *
 * IMPLEMENTATION NOTES (Phase 2 tab):
 *  - Provider SDK imports belong ONLY in packages/adapters (CLAUDE.md §4). Reuse
 *    the existing Unipile client/config from packages/adapters/src/unipile.
 *  - Translate each LeadSourceKind to the matching Unipile search endpoint and
 *    map provider rows → SourcedLead. Page via LeadSourceResult.nextCursor.
 *  - Respect account safety: the orchestration/import layer clamps totals; this
 *    adapter only fetches what it is asked for.
 *  - Do NOT throw raw provider errors past this boundary — surface clean messages.
 */
export interface UnipileLeadSourceConfig {
  apiKey: string;
  dsn: string;
}

export class UnipileLeadSourceAdapter implements LeadSourceAdapter {
  // Config is accepted but unused until the Phase 2 tab wires the real transport.
  constructor(_config: UnipileLeadSourceConfig) {}

  fetchLeads(
    _account: LeadSourceAccountRef,
    _query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    throw new Error(
      "UnipileLeadSourceAdapter.fetchLeads is not implemented yet (Phase 2 transport tab). " +
        "Use ADAPTER=mock for lead sourcing until the Unipile sourcing transport is wired.",
    );
  }
}
