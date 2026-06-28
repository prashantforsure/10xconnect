// Phase 3 Test Gate (DB-backed) — Limits + Budget Governor. Runs against the dev
// Postgres with deterministic MOCK adapters. The text + embedding adapters COUNT
// their calls so we can assert "ZERO model calls" on the cheap paths.
//
// Proves: the pre-gate skips trash with no model calls; the turn cap forces a
// handoff; exceeding the $ cap hard-stops a campaign to approve_all + alerts;
// metering records tokens + cost per conversation; and do_not_contact blocks both
// enrollment AND sending across campaigns.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ActionResult,
  autonomyFrom,
  type ChannelAdapter,
  EMBEDDING_DIM,
  type EmbeddingAdapter,
  hashingEmbedding,
  type TextGenerationAdapter,
} from "@10xconnect/core";

import { ingestText } from "./brain/kb";
import { runConversationTurn } from "./brain/turn";
import { utcDay } from "./brain/window";
import { enrollLeads } from "./campaign-runner";
import { dispatchDueActions } from "./dispatch";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const FIXED = new Date("2026-06-28T12:00:00.000Z");
const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });
const KB_DOC =
  "Pricing. Our Pro plan is $99 per month and includes unlimited contacts, priority support, and the AI assistant.";

/** A call-counting text adapter (proves "ZERO LLM calls" on the cheap paths). */
function countingText(counter: { text: number }): TextGenerationAdapter {
  return {
    generate: async () => {
      counter.text += 1;
      return "Sure — happy to help with that.";
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
    sendConnectionRequest: async (_a: unknown, _l: unknown, opts: { idempotencyKey: string }) => {
      sink.push({ idempotencyKey: opts.idempotencyKey, body: "<connect>" });
      return { status: "success", idempotencyKey: opts.idempotencyKey, at: FIXED.toISOString() } satisfies ActionResult;
    },
  } as unknown as ChannelAdapter;
}

function deps(
  db: EngineDeps["db"],
  adapter: ChannelAdapter,
  over: Partial<EngineDeps> = {},
): EngineDeps {
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
  limits?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  autonomy?: Record<string, unknown>;
  embedder?: EmbeddingAdapter;
}

/** Seed an account, lead, KB (doc ingested), and a brain campaign. */
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
      email: `lead-${randomUUID()}@example.com`,
      enrichment: JSON.stringify({ firstName: "Jordan" }),
      tags: [],
      connection_degree: 1,
      enrich_status: "enriched",
    })
    .returning(["id", "linkedin_url", "email"])
    .executeTakeFirstOrThrow();
  const kb = await db
    .insertInto("knowledge_bases")
    .values({ workspace_id: workspaceId, name: "Product KB" })
    .returning("id")
    .executeTakeFirstOrThrow();
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
  return { accountId: account.id, leadId: lead.id, lead, kbId: kb.id, campaignId: campaign.id };
}

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

test("pre-gate skips trash inbound with ZERO model calls", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder });
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Thanks!");

    const before = { ...counter }; // ignore seeding embeds
    const outcome = await runConversationTurn(
      deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );

    assert.equal(outcome.status, "skipped");
    assert.equal((outcome as { reason: string }).reason, "low_signal");
    assert.equal(counter.text - before.text, 0, "no text-model call on trash");
    assert.equal(counter.embed - before.embed, 0, "no embedding call on trash");

    const drafts = await db.selectFrom("message_drafts").select("id").where("conversation_id", "=", convoId).execute();
    assert.equal(drafts.length, 0, "no draft written for trash");
  } finally {
    await w.cleanup();
  }
});

test("hitting max_ai_turns forces a handoff (no model calls)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, {
      embedder,
      limits: { max_ai_turns: 2 },
    });
    // The lead has already had 2 AI replies → the cap is reached.
    await db
      .insertInto("relationship_state")
      .values({ lead_id: leadId, workspace_id: workspaceId, campaign_id: campaignId, ai_turn_count: 2 })
      .execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "What's included in the Pro plan?");

    const before = { ...counter };
    const outcome = await runConversationTurn(
      deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );

    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "max_turns");
    assert.equal(counter.text - before.text, 0, "no model call on a turn-cap handoff");

    const draft = await db
      .selectFrom("message_drafts")
      .select(["status", "body", "reasoning"])
      .where("conversation_id", "=", convoId)
      .executeTakeFirstOrThrow();
    assert.equal(draft.status, "escalated");
    assert.equal(draft.body, null);
    assert.equal((draft.reasoning as { reason?: string }).reason, "max_turns");

    const convo = await db.selectFrom("conversations").select("needs_attention as n").where("id", "=", convoId).executeTakeFirstOrThrow();
    assert.equal(convo.n, true, "thread flagged for a human");
  } finally {
    await w.cleanup();
  }
});

test("exceeding the $ budget hard-stops the campaign to approve_all + alerts", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, {
      embedder,
      budget: { daily_usd_cap: 0.01 },
      autonomy: { mode: "auto_easy_escalate_hard" }, // must get dropped to approve_all
    });
    // Pre-spend the budget (already over cap for today).
    await db
      .insertInto("budget_ledger")
      .values({ campaign_id: campaignId, window: utcDay(FIXED), workspace_id: workspaceId, tokens_used: 5000, usd_used: 0.02 })
      .execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How much does the Pro plan cost?");

    const before = { ...counter };
    const outcome = await runConversationTurn(
      deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );

    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "budget_exceeded");
    assert.equal(counter.text - before.text, 0, "no spend once over budget");
    assert.equal(counter.embed - before.embed, 0, "no retrieval once over budget");

    // Autonomy dropped to approve_all (the Phase 4 interlock).
    const campaign = await db.selectFrom("campaigns").select("autonomy").where("id", "=", campaignId).executeTakeFirstOrThrow();
    assert.equal(autonomyFrom(campaign.autonomy).mode, "approve_all");

    // A budget-exhausted notification was raised, once.
    const notifs = await db.selectFrom("notifications").select("type").where("workspace_id", "=", workspaceId).where("type", "=", "ai_budget_exceeded").execute();
    assert.equal(notifs.length, 1, "owner alerted that the budget is exhausted");

    const ledger = await db.selectFrom("budget_ledger").select("hard_stopped as h").where("campaign_id", "=", campaignId).executeTakeFirstOrThrow();
    assert.equal(ledger.h, true);
  } finally {
    await w.cleanup();
  }
});

test("metering records tokens + cost per conversation and per campaign", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const { accountId, leadId, campaignId } = await seedBrain(db, workspaceId, { embedder });
    // Non-sensitive grounded question (pricing is a Phase 4 hot-lead trigger).
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Does the Pro plan include priority support?");

    const outcome = await runConversationTurn(
      deps(db, recordingAdapter([]), { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );
    assert.equal(outcome.status, "drafted");
    assert.equal(counter.text, 1, "the draft went through the metered model exactly once");

    // Per-conversation usage row.
    const usage = await db
      .selectFrom("llm_usage")
      .select(["kind", "total_tokens as totalTokens", "usd"])
      .where("conversation_id", "=", convoId)
      .executeTakeFirstOrThrow();
    assert.equal(usage.kind, "draft");
    assert.ok(Number(usage.totalTokens) > 0, "tokens recorded");
    assert.ok(Number(usage.usd) > 0, "cost recorded");

    // Per-campaign daily rollup.
    const ledger = await db
      .selectFrom("budget_ledger")
      .select(["tokens_used as tokensUsed", "usd_used as usdUsed"])
      .where("campaign_id", "=", campaignId)
      .where("window", "=", utcDay(FIXED))
      .executeTakeFirstOrThrow();
    assert.ok(Number(ledger.tokensUsed) > 0, "campaign tokens rolled up");
    assert.ok(Number(ledger.usdUsed) > 0, "campaign cost rolled up");
  } finally {
    await w.cleanup();
  }
});

test("do_not_contact blocks enrollment AND sending across campaigns", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const { accountId, leadId, lead, campaignId } = await seedBrain(db, workspaceId);

    // Suppress the lead.
    await db
      .insertInto("do_not_contact")
      .values({ workspace_id: workspaceId, linkedin_url: lead.linkedin_url, email: lead.email, reason: "not_interested" })
      .execute();

    // (a) Enrollment is blocked.
    const enroll = await enrollLeads(deps(db, recordingAdapter([])), workspaceId, campaignId, [leadId]);
    assert.equal(enroll.skippedSuppressed, 1, "suppressed lead not enrolled");
    assert.equal(enroll.enrolled, 0);
    const state = await db.selectFrom("lead_campaign_state").select("lead_id").where("campaign_id", "=", campaignId).where("lead_id", "=", leadId).executeTakeFirst();
    assert.equal(state, undefined, "no lead_campaign_state for a suppressed lead");

    // (b) A queued transport send is blocked at dispatch (across ALL campaigns).
    const node = await db
      .insertInto("sequence_nodes")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, kind: "action", type: "send_message", config: JSON.stringify({ body: "hi" }) })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("lead_campaign_state")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, current_node_id: node.id, status: "active", history: JSON.stringify([]) })
      .execute();
    await db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: accountId,
        lead_id: leadId,
        campaign_id: campaignId,
        node_id: node.id,
        type: "message",
        status: "pending",
        idempotency_key: `send:${randomUUID()}`,
        scheduled_at: FIXED.toISOString(),
        config: JSON.stringify({ body: "hi" }),
      })
      .execute();

    const sink: { idempotencyKey: string; body: string }[] = [];
    await dispatchDueActions(deps(db, recordingAdapter(sink)));

    const sent = await db
      .selectFrom("actions")
      .select(["status", "result"])
      .where("lead_id", "=", leadId)
      .where("type", "=", "message")
      .executeTakeFirstOrThrow();
    assert.equal(sent.status, "skipped", "queued send skipped for a suppressed lead");
    assert.equal((sent.result as { reason?: string }).reason, "suppressed");
    assert.equal(sink.length, 0, "nothing sent to the provider");
  } finally {
    await w.cleanup();
  }
});
