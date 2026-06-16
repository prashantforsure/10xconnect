// @10xconnect/adapters — ChannelAdapter implementations.
// This is the ONLY package allowed to import provider SDKs (Unipile, ESP, LLM,
// TTS) per CLAUDE.md §4. The mock adapter (Step 8) is what the whole system is
// developed and tested against until a step explicitly needs Unipile.
export * from "./mock";
export * from "./factory";
export * from "./webhook-receiver";
// Note: the Unipile adapter is intentionally NOT exported here — it is only
// constructed by the factory, so Unipile wire types never leak out of the package.
