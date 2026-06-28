// Knowledge base + facts: ingestion (chunk → embed → store) and cosine-KNN
// retrieval over pgvector. Embeddings are stored/queried as text vector literals
// with an explicit `::vector` cast (pgvector); retrieval is exact KNN (`<=>`
// cosine distance), which is plenty for the small per-campaign KBs we expect.

import {
  chunkText,
  type EmbeddingAdapter,
  estimateTokens,
  toVectorLiteral,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { type Kysely, sql } from "kysely";

export interface Retrieved {
  id: string;
  body: string;
  similarity: number;
}

/** A pgvector literal bound + cast, e.g. `$1::vector`. */
function vec(literal: string) {
  return sql<string>`${literal}::vector`;
}

/** Chunk, embed, and store text into a knowledge base. Returns chunks stored. */
export async function ingestText(
  db: Kysely<DB>,
  embedder: EmbeddingAdapter,
  input: { workspaceId: string; knowledgeBaseId: string; text: string; source?: string },
): Promise<{ chunks: number }> {
  const chunks = chunkText(input.text);
  if (chunks.length === 0) return { chunks: 0 };

  const rows = await Promise.all(
    chunks.map(async (body) => ({
      workspace_id: input.workspaceId,
      knowledge_base_id: input.knowledgeBaseId,
      body,
      embedding: toVectorLiteral(await embedder.embed(body)),
      token_count: estimateTokens(body),
      metadata: JSON.stringify({ source: input.source ?? "manual" }),
    })),
  );

  // Insert with an explicit ::vector cast on each embedding literal.
  for (const r of rows) {
    await db
      .insertInto("kb_chunks")
      .values({ ...r, embedding: vec(r.embedding) })
      .execute();
  }
  return { chunks: rows.length };
}

/** Top-k KB chunks for a query, most-similar first (cosine). */
export async function retrieveChunks(
  db: Kysely<DB>,
  embedder: EmbeddingAdapter,
  knowledgeBaseId: string,
  query: string,
  k = 4,
): Promise<Retrieved[]> {
  const literal = toVectorLiteral(await embedder.embed(query));
  const rows = await db
    .selectFrom("kb_chunks")
    .select(["id", "body"])
    .select(sql<number>`1 - (embedding <=> ${vec(literal)})`.as("similarity"))
    .where("knowledge_base_id", "=", knowledgeBaseId)
    .where("embedding", "is not", null)
    .orderBy(sql`embedding <=> ${vec(literal)}`)
    .limit(k)
    .execute();
  return rows.map((r) => ({ id: r.id, body: r.body, similarity: Number(r.similarity) }));
}

/** Top-k facts about a lead for a query, most-similar first. */
export async function retrieveFacts(
  db: Kysely<DB>,
  embedder: EmbeddingAdapter,
  leadId: string,
  query: string,
  k = 4,
): Promise<Retrieved[]> {
  const literal = toVectorLiteral(await embedder.embed(query));
  const rows = await db
    .selectFrom("facts")
    .select(["id", "body"])
    .select(sql<number>`1 - (embedding <=> ${vec(literal)})`.as("similarity"))
    .where("lead_id", "=", leadId)
    .where("embedding", "is not", null)
    .orderBy(sql`embedding <=> ${vec(literal)}`)
    .limit(k)
    .execute();
  return rows.map((r) => ({ id: r.id, body: r.body, similarity: Number(r.similarity) }));
}

/** Upsert a fact about a lead (one row per topic), embedding it for retrieval. */
export async function upsertFact(
  db: Kysely<DB>,
  embedder: EmbeddingAdapter | null | undefined,
  input: {
    workspaceId: string;
    leadId: string;
    campaignId: string | null;
    topic: string;
    body: string;
    source?: string;
    confidence?: number;
  },
): Promise<void> {
  const literal = embedder ? toVectorLiteral(await embedder.embed(input.body)) : null;
  await db
    .insertInto("facts")
    .values({
      workspace_id: input.workspaceId,
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      topic: input.topic,
      body: input.body,
      embedding: literal ? vec(literal) : null,
      source: input.source ?? "conversation",
      confidence: input.confidence ?? null,
    })
    .onConflict((oc) =>
      oc.columns(["lead_id", "topic"]).doUpdateSet({
        body: input.body,
        embedding: literal ? vec(literal) : null,
        source: input.source ?? "conversation",
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}
