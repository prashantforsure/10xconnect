// Gemini implementation of the TextGenerationAdapter (CLAUDE.md §3 — swappable
// "cheap model" LLM; §4 — provider calls live ONLY in packages/adapters). Uses
// the Google Generative Language REST API directly (no SDK), so nothing leaks out
// of this package but the core TextGenerationAdapter interface.

import type { TextGenerationAdapter, TextGenerationInput } from "@10xconnect/core";

export interface GeminiConfig {
  apiKey: string;
  /** e.g. "gemini-2.0-flash" (default) / "gemini-1.5-flash". */
  model: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

export class GeminiTextAdapter implements TextGenerationAdapter {
  constructor(private readonly config: GeminiConfig) {}

  async generate(input: TextGenerationInput): Promise<string> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}` +
      `:generateContent?key=${encodeURIComponent(this.config.apiKey)}`;

    const body = {
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      ...(input.system
        ? { systemInstruction: { role: "system", parts: [{ text: input.system }] } }
        : {}),
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        maxOutputTokens: input.maxTokens ?? 256,
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
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) {
      throw new Error("Gemini returned no text");
    }
    return text;
  }
}
