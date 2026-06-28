// Knowledge-base chunking (pure). Splits ingested text into bounded chunks on
// paragraph then sentence boundaries so each chunk is a coherent, separately
// retrievable unit. Deterministic.

export interface ChunkOptions {
  /** Soft max characters per chunk (~150-200 tokens at 800). */
  maxChars?: number;
  /** Drop chunks shorter than this (noise). */
  minChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = { maxChars: 800, minChars: 24 };

function splitSentences(paragraph: string): string[] {
  // Split after sentence-ending punctuation followed by whitespace.
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Chunk text into bounded, coherent pieces for embedding. */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { maxChars, minChars } = { ...DEFAULTS, ...options };
  const paragraphs = (text ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      chunks.push(para);
      continue;
    }
    // Long paragraph: accumulate sentences up to maxChars.
    let current = "";
    for (const sentence of splitSentences(para)) {
      if (current && current.length + sentence.length + 1 > maxChars) {
        chunks.push(current.trim());
        current = "";
      }
      current = current ? `${current} ${sentence}` : sentence;
      // A single sentence longer than maxChars is hard-split.
      while (current.length > maxChars) {
        chunks.push(current.slice(0, maxChars).trim());
        current = current.slice(maxChars);
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }

  return chunks.filter((c) => c.length >= minChars);
}

/** Rough token estimate (~4 chars/token) for budgeting + metrics. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}
