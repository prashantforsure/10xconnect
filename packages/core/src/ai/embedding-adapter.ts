// Embedding boundary (mirrors TextGenerationAdapter). Provider SDKs live in
// packages/adapters; this is the pure interface + a deterministic hashing
// embedder used by the mock adapter (and as the offline grounding engine).

/** Fixed embedding dimension. Gemini text-embedding-004 and the mock both emit this. */
export const EMBEDDING_DIM = 768;

/**
 * Below this cosine similarity, a retrieved chunk is "not relevant" — the
 * grounding guard treats a factual question with no chunk above this as
 * out-of-knowledge (escalate, never fabricate). Tuned for the hashing
 * (bag-of-words) mock so keyword-overlapping text clears it and unrelated
 * text does not; a real embedder clears it far more easily.
 */
export const GROUNDING_MIN_SIMILARITY = 0.12;

export interface EmbeddingAdapter {
  readonly dimension: number;
  /** Embed one text into a unit-length vector. */
  embed(text: string): Promise<number[]>;
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on", "for", "is",
  "are", "was", "were", "be", "been", "do", "does", "did", "you", "your", "we",
  "our", "i", "it", "this", "that", "with", "as", "at", "by", "from", "how", "what",
  "can", "could", "would", "will", "about", "me", "my", "us", "they", "their",
]);

/** Tokenize: lowercase alphanumeric words, stopwords removed, length >= 2. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t),
  );
}

/** djb2 unsigned hash. */
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic bag-of-words embedding via the hashing trick: each token maps
 * to a bucket (with a sign hash to spread collisions), term-frequency weighted,
 * then L2-normalized. Cosine similarity then tracks shared-keyword overlap, so
 * RAG retrieval behaves meaningfully OFFLINE (no embedding API key needed).
 */
export function hashingEmbedding(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const bucket = hash(tok) % dim;
    const sign = (hash(`sign:${tok}`) & 1) === 0 ? 1 : -1;
    vec[bucket] += sign;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

/** Cosine similarity of two equal-length vectors (unit vectors → dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Format a JS vector as a pgvector text literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
