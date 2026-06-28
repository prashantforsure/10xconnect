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
}

/**
 * USD per 1K tokens. `mock` is priced (non-zero) on purpose so the budget
 * governor is exercisable end-to-end with the deterministic mock adapter.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.0-flash": { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  "gemini-1.5-flash": { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  "gemini-1.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.005 },
  mock: { inputPer1k: 0.0001, outputPer1k: 0.0004 },
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

/** USD cost of one call's token usage at the model's price. */
export function estimateUsd(usage: TokenUsage, model: string | null | undefined): number {
  const p = pricingFor(model);
  return (usage.promptTokens / 1000) * p.inputPer1k + (usage.completionTokens / 1000) * p.outputPer1k;
}

/**
 * Estimate token usage from the prompt + output text (deterministic ~4 chars/token).
 * Used when the provider doesn't report usage. Counts the system prompt too.
 */
export function estimateUsage(input: { prompt: string; system?: string }, output: string): TokenUsage {
  const promptTokens = estimateTokens(`${input.system ?? ""}\n${input.prompt}`);
  const completionTokens = estimateTokens(output);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}
