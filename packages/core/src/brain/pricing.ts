// LLM cost model (pure) — the $ side of the budget governor. Token→USD pricing
// per model, plus a deterministic token estimate used when a provider doesn't
// report usage (the mock adapter, or providers without usageMetadata). Prices are
// USD per 1K tokens; keep them conservative (over-estimating spend is the safe
// direction for a budget cap). Swap the table as providers/prices change.

import type { TokenUsage } from "../ai/text-adapter";

import { estimateTokens } from "./chunk";


export interface ModelPricing {
  /** USD per 1K input (prompt) tokens. */
  inputPer1k: number;
  /** USD per 1K output (completion) tokens. */
  outputPer1k: number;
  /**
   * USD per 1K CACHED input tokens (Phase 9.8 prompt caching). Cheaper than
   * `inputPer1k` — providers bill a cached prefix at a fraction of the fresh rate
   * (Gemini ≈ 25%). Defaults to `inputPer1k` (no discount) when unset.
   */
  cachedInputPer1k?: number;
}

/**
 * USD per 1K tokens. `mock` is priced (non-zero) on purpose so the budget
 * governor is exercisable end-to-end with the deterministic mock adapter.
 * Cached-input rate ≈ 25% of fresh input (Gemini's prompt-cache discount).
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.0-flash": { inputPer1k: 0.0001, outputPer1k: 0.0004, cachedInputPer1k: 0.000025 },
  "gemini-1.5-flash": { inputPer1k: 0.000075, outputPer1k: 0.0003, cachedInputPer1k: 0.00001875 },
  "gemini-1.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.005, cachedInputPer1k: 0.0003125 },
  mock: { inputPer1k: 0.0001, outputPer1k: 0.0004, cachedInputPer1k: 0.000025 },
};

const FALLBACK_PRICING: ModelPricing = MODEL_PRICING["gemini-2.0-flash"];

/** Pricing for a model id (case-insensitive prefix match), else a safe default. */
export function pricingFor(model: string | null | undefined): ModelPricing {
  if (!model) return FALLBACK_PRICING;
  const key = model.toLowerCase();
  if (MODEL_PRICING[key]) return MODEL_PRICING[key];
  // Prefix match (e.g. "gemini-2.0-flash-001" → "gemini-2.0-flash").
  const hit = Object.keys(MODEL_PRICING).find((k) => key.startsWith(k));
  return hit ? MODEL_PRICING[hit] : FALLBACK_PRICING;
}

/**
 * USD cost of one call's token usage at the model's price. Cached prompt tokens
 * (Phase 9.8) are billed at the cheaper cached-input rate; the remaining (fresh)
 * prompt tokens at the normal input rate.
 */
export function estimateUsd(usage: TokenUsage, model: string | null | undefined): number {
  const p = pricingFor(model);
  const cached = Math.min(Math.max(0, usage.cachedTokens ?? 0), usage.promptTokens);
  const fresh = usage.promptTokens - cached;
  const cachedRate = p.cachedInputPer1k ?? p.inputPer1k;
  return (
    (fresh / 1000) * p.inputPer1k +
    (cached / 1000) * cachedRate +
    (usage.completionTokens / 1000) * p.outputPer1k
  );
}

/**
 * Estimate token usage from the prompt + output text (deterministic ~4 chars/token).
 * Used when the provider doesn't report usage. Counts the system prompt + any
 * cache prefix too. The estimate path reports no cached tokens (conservative — it
 * prices a cache miss, the safe direction for a budget cap).
 */
export function estimateUsage(
  input: { prompt: string; system?: string; cachePrefix?: string },
  output: string,
): TokenUsage {
  const promptTokens = estimateTokens(`${input.system ?? ""}\n${input.cachePrefix ?? ""}\n${input.prompt}`);
  const completionTokens = estimateTokens(output);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}
