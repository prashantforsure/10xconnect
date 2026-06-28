import { env } from "@10xconnect/config";
import type { EmbeddingAdapter, TextGenerationAdapter } from "@10xconnect/core";

import { GeminiEmbeddingAdapter } from "./gemini-embedding-adapter";
import { GeminiTextAdapter } from "./gemini-text-adapter";
import { MockEmbeddingAdapter } from "./mock-embedding-adapter";
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

/**
 * Resolve the embedding adapter (mirrors createTextAdapter). Falls back to
 * EMBEDDING_API_KEY ?? LLM_API_KEY for Gemini, and to the deterministic mock
 * whenever no key is configured but the mock channel adapter is in use — so the
 * knowledge base + grounding guard work fully offline.
 */
export function createEmbeddingAdapter(): EmbeddingAdapter | null {
  if (env.EMBEDDING_PROVIDER === "mock") {
    return new MockEmbeddingAdapter();
  }
  const apiKey = env.EMBEDDING_API_KEY ?? env.LLM_API_KEY;
  if (apiKey) {
    return new GeminiEmbeddingAdapter({ apiKey, model: env.EMBEDDING_MODEL });
  }
  return env.ADAPTER === "mock" ? new MockEmbeddingAdapter() : null;
}
