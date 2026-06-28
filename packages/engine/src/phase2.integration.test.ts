// Phase 2 Test Gate (DB-backed, pgvector). Runs against the dev Postgres with
// the deterministic MOCK adapters (no API key): the hashing embedder makes
// retrieval similarity real, so the grounding guard is genuinely exercised.
//
// Proves: doc ingestion → retrievable chunks; a KB-answerable question →
// grounded draft citing the right chunk; an unknown factual question → clean
// escalation with NO fabricated answer; reflection writes facts + bumps
// intent_score; drafts are NEVER auto-sent (approve_all).
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ActionResult,
  type ChannelAdapter,
  EMBEDDING_DIM,
  type EmbeddingAdapter,
  hashingEmbedding,
  type TextGenerationAdapter,
} from "@10xconnect/core";

import { ingestText, retrieveChunks } from "./brain/kb";
import { approveDraft } from "./brain/reflect";
import { runConversationTurn } from "./brain/turn";
import { dispatchDueActions } from "./dispatch";
import { processInboundEvent } from "./inbound";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const KB_DOC = [
  "Pricing. Our Starter plan is $29 per month for up to 1000 contacts. The Pro plan is $99 per month and includes unlimited contacts, priority support, and the AI assistant. Enterprise pricing is custom — contact sales for a quote.",
  "Support. All paid plans include email support during business hours. Pro and Enterprise customers also get priority support with a four hour response SLA.",
].join("\n\n");

const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });

const mockEmbedder: EmbeddingAdapter = {
  dimension: EMBEDDING_DIM,
  embed: async (text: string) => hashingEmbedding(text),
};
const mockText: TextGenerationAdapter = {
  generate: async () => "Happy to help! Here's a quick answer for you.",
};
function recordingAdapter(sink: { idempotencyKey: string; body: string }[]): ChannelAdapter {
  return {
    sendMessage: async (_a: unknown, _l: unknown, content: { body: string }, opts: { idempotencyKey: string }) => {
      sink.push({ idempotencyKey: opts.idempotencyKey, body: content.body });
      return { status: "success", idempotencyKey: opts.idempotencyKey, at: new Date().toISOString() } satisfies ActionResult;
    },
  } as unknown as ChannelAdapter;
}

function brainDeps(db: EngineDeps["db"], adapter: ChannelAdapter): EngineDeps {
  return {
    db,
    adapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => new Date(),
    textAdapter: mockText,
    embeddingAdapter: mockEmbedder,
  };
}

/** Seed an account, lead, KB (with the doc ingested), and a brain campaign. */
async function seedBrain(db: EngineDeps["db"], workspaceId: string) {
  const account = await db
    .insertInto("sending_accounts")
    .values({
      workspace_id: workspaceId,
      type: "linkedin",
      connection_method: "extension",
      name: "Test",
      provider_account_id: `prov-${randomUUID()}`,
      proxy_type: "bundled",
      country: "US",
      location: "US",
      status: "active",
      health_score: 100,
      warmup_state: WARMED,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const lead = await db
    .insertInto("leads")
    .values({
      workspace_id: workspaceId,
      linkedin_url: `https://linkedin.com/in/lead-${randomUUID()}`,
      enrichment: JSON.stringify({ firstName: "Jordan" }),
      tags: [],
      connection_degree: 1,
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const kb = await db
    .insertInto("knowledge_bases")
    .values({ workspace_id: workspaceId, name: "Product KB" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await ingestText(db, mockEmbedder, { workspaceId, knowledgeBaseId: kb.id, text: KB_DOC, source: "doc" });
  const campaign = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "Brain",
      status: "running",
      account_id: account.id,
      objective: JSON.stringify({ goal: "book a demo", cta: "a quick 15-min call" }),
      knowledge_base_id: kb.id,
      autonomy: JSON.stringify({ mode: "approve_all" }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { accountId: account.id, leadId: lead.id, kbId: kb.id, campaignId: campaign.id };
}

/** Create a conversation with one inbound message (the prospect's question). */
async function seedConversation(
  db: EngineDeps["db"],
  workspaceId: string,
  accountId: string,
  leadId: string,
  question: string,
) {
  const convo = await db
    .insertInto("conversations")
    .values({
      workspace_id: workspaceId,
      account_id: accountId,
      lead_id: leadId,
      channel: "linkedin",
      pipeline_stage: "in_conversation",
      needs_attention: true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("messages")
    .values({ workspace_id: workspaceId, conversation_id: convo.id, direction: "inbound", channel: "linkedin", body: question })
    .execute();
  return convo.id;
}

test("ingesting a doc produces retrievable chunks", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const kb = await db
      .insertInto("knowledge_bases")
      .values({ workspace_id: workspaceId, name: "KB" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const res = await ingestText(db, mockEmbedder, { workspaceId, knowledgeBaseId: kb.id, text: KB_DOC });
    assert.ok(res.chunks >= 2, "doc should split into >= 2 chunks");

    const stored = await db
      .selectFrom("kb_chunks")
      .select("id")
      .where("knowledge_base_id", "=", kb.id)
      .where("embedding", "is not", null)
      .execute();
    assert.equal(stored.length, res.chunks, "every chunk is embedded");

    const hits = await retrieveChunks(db, mockEmbedder, kb.id, "how much does the pro plan cost per month", 3);
    assert.ok(hits.length > 0);
    assert.match(hits[0].body, /Pricing/, "pricing chunk ranks first for a pricing query");
    assert.ok(hits[0].similarity >= 0.12, "top similarity clears the grounding threshold");
  } finally {
    await w.cleanup();
  }
});

test("a KB-answerable question yields a grounded draft citing the right chunk (not sent)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const { accountId, leadId, kbId, campaignId } = await seedBrain(db, workspaceId);
    // A NON-sensitive KB question (pricing is a Phase 4 hot-lead trigger now).
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Does the Pro plan include priority support?");

    const supportChunk = await db
      .selectFrom("kb_chunks")
      .select("id")
      .where("knowledge_base_id", "=", kbId)
      .where("body", "like", "Support%")
      .executeTakeFirstOrThrow();

    const outcome = await runConversationTurn(brainDeps(db, recordingAdapter([])), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "drafted");

    const draft = await db
      .selectFrom("message_drafts")
      .select(["status", "body", "reasoning"])
      .where("conversation_id", "=", convoId)
      .executeTakeFirstOrThrow();
    assert.equal(draft.status, "pending");
    assert.ok(draft.body && draft.body.length > 0, "a draft body exists");
    const reasoning = draft.reasoning as { action?: string; chunkIds?: string[] };
    assert.equal(reasoning.action, "answer");
    assert.ok((reasoning.chunkIds?.length ?? 0) > 0, "draft is grounded in a chunk");
    assert.ok(reasoning.chunkIds?.includes(supportChunk.id), "draft cites the support chunk");

    // NEVER auto-sent: no reply action, no outbound message yet.
    const replyActions = await db
      .selectFrom("actions")
      .select("id")
      .where("lead_id", "=", leadId)
      .where("type", "=", "message")
      .execute();
    assert.equal(replyActions.length, 0, "no reply enqueued before approval");
    const outbound = await db
      .selectFrom("messages")
      .select("id")
      .where("conversation_id", "=", convoId)
      .where("direction", "=", "outbound")
      .execute();
    assert.equal(outbound.length, 0, "nothing sent");
  } finally {
    await w.cleanup();
  }
});

test("an unknown factual question escalates with NO fabricated answer", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId);
    const convoId = await seedConversation(
      db,
      workspaceId,
      accountId,
      leadId,
      "Do you integrate with Salesforce and Pipedrive?",
    );

    const outcome = await runConversationTurn(brainDeps(db, recordingAdapter([])), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "escalated");

    const draft = await db
      .selectFrom("message_drafts")
      .select(["status", "body", "reasoning"])
      .where("conversation_id", "=", convoId)
      .executeTakeFirstOrThrow();
    assert.equal(draft.status, "escalated");
    assert.equal(draft.body, null, "no fabricated answer");
    assert.equal((draft.reasoning as { reason?: string }).reason, "out_of_knowledge");
  } finally {
    await w.cleanup();
  }
});

test("approving a draft reflects: writes a fact and bumps intent_score (then dispatch sends)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId);
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Does the Pro plan include priority support?");

    await runConversationTurn(brainDeps(db, recordingAdapter([])), { conversationId: convoId, campaignId, leadId });
    const draft = await db
      .selectFrom("message_drafts")
      .select("id")
      .where("conversation_id", "=", convoId)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();

    const sent: { idempotencyKey: string; body: string }[] = [];
    const deps = brainDeps(db, recordingAdapter(sent));
    const res = await approveDraft(deps, { workspaceId, draftId: draft.id });
    assert.equal(res.status, "approved");

    // Reflection wrote a fact + advanced the relationship.
    const facts = await db.selectFrom("facts").select(["topic", "body"]).where("lead_id", "=", leadId).execute();
    assert.ok(facts.length >= 1, "reflection persists a fact");
    const rel = await db
      .selectFrom("relationship_state")
      .select(["intent_score", "ai_turn_count"])
      .where("lead_id", "=", leadId)
      .executeTakeFirstOrThrow();
    assert.equal(rel.intent_score, 5, "question intent bumps the score");
    assert.equal(rel.ai_turn_count, 1);

    const approved = await db.selectFrom("message_drafts").select("status").where("id", "=", draft.id).executeTakeFirstOrThrow();
    assert.equal(approved.status, "approved");

    // Approval enqueued a reply through the spine; dispatch sends it via adapter.
    await dispatchDueActions(deps);
    assert.ok(sent.some((s) => s.idempotencyKey === `reply:${convoId}:${draft.id}`), "approved reply dispatched");
    const outbound = await db
      .selectFrom("messages")
      .select("body")
      .where("conversation_id", "=", convoId)
      .where("direction", "=", "outbound")
      .execute();
    assert.equal(outbound.length, 1, "exactly one outbound after approval");
  } finally {
    await w.cleanup();
  }
});

test("a reply enqueues a brain turn that the worker drafts (never sends)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId);
    // Enroll the lead so the reply has an active campaign to stop + a brain to fire.
    const node = await db
      .insertInto("sequence_nodes")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, kind: "action", type: "send_message", config: JSON.stringify({}) })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("lead_campaign_state")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, current_node_id: node.id, status: "active", history: JSON.stringify([]) })
      .execute();

    const event = {
      id: `evt-${randomUUID()}`,
      type: "reply",
      accountId,
      channel: "linkedin",
      occurredAt: new Date().toISOString(),
      lead: { leadId },
      message: { providerMessageId: `m-${randomUUID()}`, direction: "inbound", channel: "linkedin", body: "What does the Pro plan cost?", sentAt: new Date().toISOString() },
    };
    await processInboundEvent({ db }, event as never);

    // A brain turn was enqueued (not a send).
    const turn = await db
      .selectFrom("actions")
      .select(["id", "status", "type"])
      .where("lead_id", "=", leadId)
      .where("type", "=", "conversation_turn")
      .executeTakeFirstOrThrow();
    assert.equal(turn.status, "pending");

    const sent: { idempotencyKey: string; body: string }[] = [];
    await dispatchDueActions(brainDeps(db, recordingAdapter(sent)));

    // The worker drafted a suggestion; nothing was sent.
    const draft = await db
      .selectFrom("message_drafts")
      .select(["status"])
      .where("lead_id", "=", leadId)
      .executeTakeFirstOrThrow();
    assert.ok(draft.status === "pending" || draft.status === "escalated");
    assert.equal(sent.length, 0, "the brain turn never sends");
  } finally {
    await w.cleanup();
  }
});
