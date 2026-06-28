// Deterministic, offline EmbeddingAdapter for dev + tests. Uses the pure
// hashing (bag-of-words) embedder from core, so cosine similarity tracks
// keyword overlap — RAG retrieval + the grounding guard behave meaningfully
// with NO embedding API key. Mirrors MockTextAdapter.

import { EMBEDDING_DIM, type EmbeddingAdapter, hashingEmbedding } from "@10xconnect/core";

export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimension = EMBEDDING_DIM;

  async embed(text: string): Promise<number[]> {
    return hashingEmbedding(text, this.dimension);
  }
}
