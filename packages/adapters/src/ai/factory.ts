import { env } from "@10xconnect/config";
import type { TextGenerationAdapter } from "@10xconnect/core";

import { GeminiTextAdapter } from "./gemini-text-adapter";
import { MockTextAdapter } from "./mock-text-adapter";

/**
 * Resolve the text-generation adapter. Selection (CLAUDE.md §3 — swappable cheap
 * model, mock-safe by default):
 *  - LLM_PROVIDER=mock                     → deterministic MockTextAdapter
 *  - LLM_API_KEY set (provider=gemini)     → GeminiTextAdapter
 *  - no key + ADAPTER=mock (dev/test)      → MockTextAdapter (so AI works offline)
 *  - no key + ADAPTER=unipile (prod)       → null (AI optional; engine falls back)
 */
export function createTextAdapter(): TextGenerationAdapter | null {
  if (env.LLM_PROVIDER === "mock") {
    return new MockTextAdapter();
  }
  if (env.LLM_API_KEY) {
    return new GeminiTextAdapter({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  }
  return env.ADAPTER === "mock" ? new MockTextAdapter() : null;
}

export function isAiConfigured(): boolean {
  return createTextAdapter() !== null;
}
