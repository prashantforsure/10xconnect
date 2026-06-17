// Lead-sourcing adapters (Step 13). The mock is what Phase 3 develops against;
// the Unipile sourcing adapter is intentionally NOT exported here (only the
// factory constructs it) so provider wire types never leak out of the package —
// same convention as the channel adapter.
export * from "./mock-lead-source-adapter";
export * from "./factory";
