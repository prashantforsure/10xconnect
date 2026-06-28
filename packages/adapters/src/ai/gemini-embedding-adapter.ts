// Gemini implementation of the EmbeddingAdapter (provider calls live ONLY in
// packages/adapters per CLAUDE.md §4). Uses the Generative Language REST
// embedContent endpoint directly (no SDK). gemini-embedding-001 defaults to 3072
// dims, so we pass outputDimensionality=EMBEDDING_DIM (768) to match the
// kb_chunks/facts vector(768) columns. (Cosine distance is scale-invariant, so the
// reduced-dimension output needs no re-normalization for pgvector <=> retrieval.)

import { EMBEDDING_DIM, type EmbeddingAdapter } from "@10xconnect/core";

export interface GeminiEmbeddingConfig {
  apiKey: string;
  /** e.g. "text-embedding-004" (default). */
  model: string;
}

interface EmbedResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

export class GeminiEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimension = EMBEDDING_DIM;

  constructor(private readonly config: GeminiEmbeddingConfig) {}

  async embed(text: string): Promise<number[]> {
    const model = this.config.model;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:embedContent?key=${encodeURIComponent(this.config.apiKey)}`;

    const body = {
      model: `models/${model}`,
      content: { parts: [{ text }] },
      // gemini-embedding-001 emits 3072 dims by default; clamp to our column width.
      outputDimensionality: this.dimension,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as EmbedResponse;
    if (!res.ok) {
      throw new Error(`Gemini embed error ${res.status}: ${data.error?.message ?? res.statusText}`);
    }
    const values = data.embedding?.values;
    if (!values || values.length === 0) {
      throw new Error("Gemini returned no embedding");
    }
    return values;
  }
}
