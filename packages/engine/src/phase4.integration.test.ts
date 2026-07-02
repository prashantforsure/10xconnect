// Phase 4 Test Gate (DB-backed) — Hot-lead detection + handoff + autonomy dial.
// Runs against the dev Postgres with deterministic MOCK adapters; the text +
// embedding adapters COUNT calls so we can assert "no model call" on handoffs.
//
// Proves: a buying signal → hot_lead + important + AI paused + summary + notify;
// auto_easy auto-sends a grounded confident answer but escalates out-of-KB /
// holds low-confidence; pricing ALWAYS escalates (even full_auto, zero threshold);
// full_auto still obeys the Phase 3 turn + budget caps; "are you AI?" returns the
// fixed honest disclosure with no model call.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ActionResult,
  AI_IDENTITY_RESPONSE,
  type ChannelAdapter,
  EMBEDDING_DIM,
  type EmbeddingAdapter,
  hashingEmbedding,
  type TextGenerationAdapter,
} from "@10xconnect/core";

import { ingestText } from "./brain/kb";
import { runConversationTurn } from "./brain/turn";
import { utcDay } from "./brain/window";
import { processInboundEvent } from "./inbound";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const FIXED = new Date("2026-06-28T12:00:00.000Z");
const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });
const KB_DOC = [
  "Onboarding. Onboarding works like this: connect your account, import your contacts, and launch. Most teams finish onboarding within fifteen minutes.",
  "Pricing. The Pro plan is $99 per month and includes priority support.",
].join("\n\n");

function countingText(counter: { text: number }): TextGenerationAdapter {
  return {
    generate: async () => {
      counter.text += 1;
      return "Onboarding takes about fifteen minutes — happy to walk you through it.";
    },
  };
}
function countingEmbedder(counter: { embed: number }): EmbeddingAdapter {
  return {
    dimension: EMBEDDING_DIM,
    embed: async (text: string) => {
      counter.embed += 1;
      return hashingEmbedding(text);
    },
  };
}
function recordingAdapter(sink: { idempotencyKey: string; body: string }[]): ChannelAdapter {
  return {
    sendMessage: async (_a: unknown, _l: unknown, content: { body: string }, opts: { idempotencyKey: string }) => {
      sink.push({ idempotencyKey: opts.idempotencyKey, body: content.body });
      return { status: "success", idempotencyKey: opts.idempotencyKey, at: FIXED.toISOString() } satisfies ActionResult;
    },
  } as unknown as ChannelAdapter;
}

function deps(db: EngineDeps["db"], adapter: ChannelAdapter, over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    db,
    adapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => FIXED,
    modelLabel: "mock",
    ...over,
  };
}

interface SeedOpts {
  autonomy?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  embedder?: EmbeddingAdapter;
}

async function seedBrain(db: EngineDeps["db"], workspaceId: string, opts: SeedOpts = {}) {
  const embedder = opts.embedder ?? countingEmbedder({ embed: 0 });
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
      enrichment: JSON.stringify({ firstName: "Dana", lastName: "Lee", headline: "VP Sales at Acme", company: "Acme", role: "VP Sales" }),
      tags: [],
      connection_degree: 1,
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const kb = await db.insertInto("knowledge_bases").values({ workspace_id: workspaceId, name: "KB" }).returning("id").executeTakeFirstOrThrow();
  await ingestText(db, embedder, { workspaceId, knowledgeBaseId: kb.id, text: KB_DOC, source: "doc" });
  const campaign = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "Brain",
      status: "running",
      account_id: account.id,
      objective: JSON.stringify({ goal: "book a demo" }),
      knowledge_base_id: kb.id,
      autonomy: JSON.stringify(opts.autonomy ?? { mode: "approve_all" }),
      ...(opts.limits ? { limits: JSON.stringify(opts.limits) } : {}),
      ...(opts.budget ? { budget: JSON.stringify(opts.budget) } : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { accountId: account.id, leadId: lead.id, kbId: kb.id, campaignId: campaign.id };
}

async function seedConversation(db: EngineDeps["db"], workspaceId: string, accountId: string, leadId: string, question: string) {
  const convo = await db
    .insertInto("conversations")
    .values({ workspace_id: workspaceId, account_id: accountId, lead_id: leadId, channel: "linkedin", pipeline_stage: "in_conversation", needs_attention: true })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.insertInto("messages").values({ workspace_id: workspaceId, conversation_id: convo.id, direction: "inbound", channel: "linkedin", body: question }).execute();
  return convo.id;
}

async function replyActions(db: EngineDeps["db"], leadId: string) {
  return db.selectFrom("actions").select(["id", "status", "config"]).where("lead_id", "=", leadId).where("type", "=", "message").execute();
}

/** Run a scenario in its own throwaway workspace (one LinkedIn account each). */
async function inWorkspace(fn: (w: Awaited<ReturnType<typeof seedWorkspace>>) => Promise<void>) {
  const w = await seedWorkspace();
  try {
    await fn(w);
  } finally {
    await w.cleanup();
  }
}

test("a buying-signal reply → hot_lead + important + AI paused + summary + notify", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    // full_auto on purpose — a buying signal hands off REGARDLESS of autonomy.
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "full_auto" } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "This looks great — send me a quote and let's move forward.");

    const before = { ...counter };
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });

    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "hot_lead");
    assert.equal(counter.text - before.text, 0, "no model call on a hot-lead handoff");

    const rel = await db.selectFrom("relationship_state").select(["stage", "do_not_reply as dnr", "summary"]).where("lead_id", "=", leadId).executeTakeFirstOrThrow();
    assert.equal(rel.stage, "hot_lead");
    assert.equal(rel.dnr, true, "AI paused on the thread");
    assert.ok(rel.summary && rel.summary.includes("Hot lead"), "a summary package was created");

    const convo = await db.selectFrom("conversations").select(["is_important as imp", "needs_attention as na"]).where("id", "=", convoId).executeTakeFirstOrThrow();
    assert.equal(convo.imp, true, "marked important");
    assert.equal(convo.na, true, "flagged for a human");

    const notif = await db.selectFrom("notifications").select(["title", "body"]).where("workspace_id", "=", workspaceId).where("type", "=", "hot_lead").executeTakeFirstOrThrow();
    assert.match(notif.title, /Hot lead/);
    assert.ok((notif.body ?? "").length > 0, "notification carries the summary");

    assert.equal((await replyActions(db, leadId)).length, 0, "nothing auto-sent for a hot lead");
  } finally {
    await w.cleanup();
  }
});

test("auto_easy: grounded+confident auto-sends; out-of-KB escalates; low-confidence holds for approval", async () => {
  // (a) grounded + confident → auto-send.
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "auto_easy_escalate_hard", confidence_threshold: 0.1 } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How does onboarding work?");
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "auto_sent", "grounded confident answer auto-sends");
    const draft = await db.selectFrom("message_drafts").select("status").where("id", "=", (outcome as { draftId: string }).draftId).executeTakeFirstOrThrow();
    assert.equal(draft.status, "approved");
    const actions = await replyActions(db, leadId);
    assert.equal(actions.length, 1, "a reply was enqueued through the spine");
    assert.equal((actions[0].config as { kind?: string }).kind, "conversation_reply");
  });

  // (b) out-of-KB factual question → escalate (grounding guard), no send.
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "auto_easy_escalate_hard", confidence_threshold: 0.1 } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Do you integrate with Salesforce?");
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "out_of_knowledge");
    assert.equal((await replyActions(db, leadId)).length, 0, "out-of-KB never auto-sends");
  });

  // (c) grounded but low-confidence → hold as a pending draft for approval.
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "auto_easy_escalate_hard", confidence_threshold: 0.95 } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How does onboarding work?");
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "drafted", "low confidence routes to human approval");
    const draft = await db.selectFrom("message_drafts").select("status").where("id", "=", (outcome as { draftId: string }).draftId).executeTakeFirstOrThrow();
    assert.equal(draft.status, "pending");
    assert.equal((await replyActions(db, leadId)).length, 0, "low-confidence is not auto-sent");
  });
});

test("a pricing question ALWAYS escalates — even full_auto with zero threshold", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "full_auto", confidence_threshold: 0 } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How much does the Pro plan cost per month?");

    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "escalated", "pricing is never auto-sent");
    assert.equal((outcome as { reason: string }).reason, "hot_lead");
    const rel = await db.selectFrom("relationship_state").select("stage").where("lead_id", "=", leadId).executeTakeFirstOrThrow();
    assert.equal(rel.stage, "hot_lead");
    assert.equal((await replyActions(db, leadId)).length, 0, "no auto-send for a money question");
  } finally {
    await w.cleanup();
  }
});

test("full_auto still respects max_ai_turns and the budget cap", async () => {
  // Positive control: full_auto auto-sends an easy grounded answer within caps.
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "full_auto" } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How does onboarding work?");
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "auto_sent");
  });

  // (a) Turn cap: already at max → handoff, no send, no model call.
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "full_auto" }, limits: { max_ai_turns: 1 } });
    await db.insertInto("relationship_state").values({ lead_id: leadId, workspace_id: workspaceId, campaign_id: campaignId, ai_turn_count: 1 }).execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How does onboarding work?");
    const before = { ...counter };
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "max_turns");
    assert.equal(counter.text - before.text, 0, "no model call at the turn cap");
    assert.equal((await replyActions(db, leadId)).length, 0, "full_auto does not send past the turn cap");
  });

  // (b) Budget cap: already over → hard-stop, no send.
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "full_auto" }, budget: { daily_usd_cap: 0.01 } });
    await db.insertInto("budget_ledger").values({ campaign_id: campaignId, window: utcDay(FIXED), workspace_id: workspaceId, tokens_used: 9999, usd_used: 0.05 }).execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How does onboarding work?");
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "budget_exceeded");
    assert.equal((await replyActions(db, leadId)).length, 0, "full_auto does not send over budget");
  });
});

test("an 'are you AI?' question returns the canned honest disclosure (no model)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    // approve_all so it stays a pending draft we can inspect.
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "approve_all" } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Quick question — are you a bot?");

    const before = { ...counter };
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "drafted");
    assert.equal(counter.text - before.text, 0, "the disclosure is canned — never model-generated");

    const draft = await db.selectFrom("message_drafts").select(["body", "reasoning"]).where("conversation_id", "=", convoId).where("status", "=", "pending").executeTakeFirstOrThrow();
    assert.equal(draft.body, AI_IDENTITY_RESPONSE, "the fixed honest disclosure is used verbatim");
    assert.equal((draft.reasoning as { tier?: string }).tier, "canned_ai_disclosure");
  } finally {
    await w.cleanup();
  }
});

test("an auto-sent reply is stamped AI-authored (drives the inbox chip + analytics)", async () => {
  await inWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder, autonomy: { mode: "auto_easy_escalate_hard", confidence_threshold: 0.1 } });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How does onboarding work?");
    const outcome = await runConversationTurn(deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }), { conversationId: convoId, campaignId, leadId });
    assert.equal(outcome.status, "auto_sent");
    const actions = await replyActions(db, leadId);
    assert.equal(actions.length, 1, "a reply was enqueued through the spine");
    assert.equal(
      (actions[0].config as { authoredBy?: string }).authoredBy,
      "ai",
      "the autonomy dial's auto-send is marked AI-authored (no human in the loop)",
    );
  });
});

test("the workspace AI SDR master switch gates the conversation_turn enqueue", async () => {
  async function enroll(db: EngineDeps["db"], workspaceId: string, campaignId: string, leadId: string) {
    const node = await db
      .insertInto("sequence_nodes")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, kind: "action", type: "send_message", config: JSON.stringify({}) })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("lead_campaign_state")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, current_node_id: node.id, status: "active", history: JSON.stringify([]) })
      .execute();
  }
  const replyEvent = (accountId: string, leadId: string) => ({
    id: `evt-${randomUUID()}`,
    type: "reply",
    accountId,
    channel: "linkedin",
    occurredAt: FIXED.toISOString(),
    lead: { leadId },
    message: { providerMessageId: `m-${randomUUID()}`, direction: "inbound", channel: "linkedin", body: "How does onboarding work?", sentAt: FIXED.toISOString() },
  });
  const turnCount = async (db: EngineDeps["db"], leadId: string) =>
    (await db.selectFrom("actions").select("id").where("lead_id", "=", leadId).where("type", "=", "conversation_turn").execute()).length;

  // Switch ON (default / unset) → a reply enqueues a brain turn.
  await inWorkspace(async ({ db, workspaceId }) => {
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { autonomy: { mode: "auto_easy_escalate_hard" } });
    await enroll(db, workspaceId, campaignId, leadId);
    await processInboundEvent({ db }, replyEvent(accountId, leadId) as never);
    assert.equal(await turnCount(db, leadId), 1, "master switch ON → brain turn enqueued");
  });

  // Switch OFF → the same reply enqueues NO brain turn (the safety valve).
  await inWorkspace(async ({ db, workspaceId }) => {
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { autonomy: { mode: "auto_easy_escalate_hard" } });
    await enroll(db, workspaceId, campaignId, leadId);
    await db.updateTable("workspaces").set({ settings: JSON.stringify({ ai_sdr_enabled: false }) as never }).where("id", "=", workspaceId).execute();
    await processInboundEvent({ db }, replyEvent(accountId, leadId) as never);
    assert.equal(await turnCount(db, leadId), 0, "master switch OFF → no brain turn (safety valve)");
  });
});
