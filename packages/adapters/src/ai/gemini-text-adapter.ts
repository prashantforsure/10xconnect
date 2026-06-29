// Gemini implementation of the TextGenerationAdapter (CLAUDE.md §3 — swappable
// "cheap model" LLM; §4 — provider calls live ONLY in packages/adapters). Uses
// the Google Generative Language REST API directly (no SDK), so nothing leaks out
// of this package but the core TextGenerationAdapter interface.

import type {
  TextGenerationAdapter,
  TextGenerationInput,
  TextGenerationResult,
} from "@10xconnect/core";

export interface GeminiConfig {
  apiKey: string;
  /** e.g. "gemini-2.0-flash" (default) / "gemini-1.5-flash". */
  model: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    /** Tokens served from Gemini's (implicit) context cache — Phase 9.8. */
    cachedContentTokenCount?: number;
    /** Hidden reasoning tokens on "thinking" models (gemini-2.5-*). Billed as output. */
    thoughtsTokenCount?: number;
  };
  error?: { message?: string };
}

// gemini-2.5-* are THINKING models: hidden reasoning tokens are drawn from the SAME
// maxOutputTokens budget as the visible reply, so a tight cap truncates the answer
// mid-sentence (finishReason=MAX_TOKENS). We do NOT disable thinking — it materially
// improves grounding (e.g. correctly deferring on out-of-KB questions instead of
// fabricating). Instead we add headroom so the visible reply (bounded by the prompt's
// own length instruction) completes after the model finishes thinking.
const THINKING_HEADROOM_TOKENS = 1024;

export class GeminiTextAdapter implements TextGenerationAdapter {
  constructor(private readonly config: GeminiConfig) {}

  async generate(input: TextGenerationInput): Promise<string> {
    return (await this.generateWithUsage(input)).text;
  }

  /** Generate AND surface Gemini's reported token usage (Phase 3 metering). */
  async generateWithUsage(input: TextGenerationInput): Promise<TextGenerationResult> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}` +
      `:generateContent?key=${encodeURIComponent(this.config.apiKey)}`;

    // The cache prefix (static brain/objective context, Phase 9.8) leads the user
    // content so Gemini's IMPLICIT context cache can match the common prefix across
    // turns and bill it at the cached rate; `cachedContentTokenCount` reports the
    // hit. (Implicit caching needs a long-enough identical prefix; below the model's
    // threshold this is simply 0 — correct, just no discount.)
    const userText = input.cachePrefix ? `${input.cachePrefix}\n\n${input.prompt}` : input.prompt;
    const body = {
      contents: [{ role: "user", parts: [{ text: userText }] }],
      ...(input.system
        ? { systemInstruction: { role: "system", parts: [{ text: input.system }] } }
        : {}),
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        // Room for the visible reply PLUS the model's hidden thinking, so a
        // thinking model never truncates the answer to fit the budget.
        maxOutputTokens: (input.maxTokens ?? 256) + THINKING_HEADROOM_TOKENS,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      throw new Error(`Gemini error ${res.status}: ${data.error?.message ?? res.statusText}`);
    }
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    // NEVER return a partial message: if the model stopped because it hit the token
    // ceiling, the reply is truncated mid-sentence. Throw so the engine treats it as
    // a generation failure (→ escalate to a human) rather than sending half a message.
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error("Gemini reply truncated (MAX_TOKENS) — refusing to send a partial message");
    }
    if (!text) {
      throw new Error("Gemini returned no text");
    }
    const u = data.usageMetadata;
    // Bill hidden thinking tokens as output (Gemini charges them) so the budget
    // governor accounts for real spend on thinking models.
    const completionTokens = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
    const usage = u
      ? {
          promptTokens: u.promptTokenCount ?? 0,
          completionTokens,
          totalTokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + completionTokens,
          cachedTokens: u.cachedContentTokenCount ?? 0,
        }
      : undefined;
    return { text, usage };
  }
}
