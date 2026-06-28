// Test gate (DB-backed) for the Campaign Context "brain config" UI batch:
// budget caps, conversation limits (max AI turns / cooldown), voice few-shot
// samples, the autonomy confidence threshold, and the "AI is off (no brain)"
// indicator. Runs against the dev Postgres with deterministic MOCK adapters.
//
// It proves the chain end to end:
//   1. ROUND-TRIP   — the exact payloads the Context tab sends validate against
//      the REAL brainConfigSchema and persist + reload via the REAL BrainService
//      (save → reload), with merge semantics (one card's save can't clobber the
//      others).
//   2. HONORED      — config written via BrainService is actually read by the
//      engine: max_ai_turns forces a handoff at the cap; cooldown_minutes skips a
//      reply inside the window; a low USD cap hard-stops the campaign to approve_all.
//   3. AI-OFF GATE  — the inbound pipeline only enqueues a conversation turn when
//      the campaign has a brain, matching hasCampaignBrain (the same predicate the
//      UI indicator uses) — and an empty objective does NOT count as a brain.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ActionResult,
  autonomyFrom,
  type ChannelAdapter,
  EMBEDDING_DIM,
  type EmbeddingAdapter,
  hasCampaignBrain,
  hashingEmbedding,
  type InboundEvent,
  type TextGenerationAdapter,
} from "@10xconnect/core";
import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import {
  type EngineDeps,
  ingestText,
  processInboundEvent,
  runConversationTurn,
  utcDay,
} from "@10xconnect/engine";
import type { Kysely } from "kysely";

import { BrainService, brainConfigSchema } from "./brain.module";

const FIXED = new Date("2026-06-28T12:00:00.000Z");
const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });
const KB_DOC =
  "Pricing. Our Pro plan is $99 per month and includes unlimited contacts, priority support, and the AI assistant.";

// setBrain/getBrain/budgetUsage only touch the DB — the adapter is never used.
const fakeAdapter = {} as never;

// --- mock adapters (counting, so we can assert ZERO model calls) ------------

function countingText(c: { text: number }): TextGenerationAdapter {
  return {
    generate: async () => {
      c.text += 1;
      return "Sure — happy to help with that.";
    },
  };
}
function countingEmbedder(c: { embed: number }): EmbeddingAdapter {
  return {
    dimension: EMBEDDING_DIM,
    embed: async (text: string) => {
      c.embed += 1;
      return hashingEmbedding(text);
    },
  };
}
function recordingAdapter(): ChannelAdapter {
  return {
    sendMessage: async (_a: unknown, _l: unknown, _c: unknown, opts: { idempotencyKey: string }) =>
      ({ status: "success", idempotencyKey: opts.idempotencyKey, at: FIXED.toISOString() }) satisfies ActionResult,
  } as unknown as ChannelAdapter;
}
function engineDeps(db: Kysely<DB>, over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    db,
    adapter: recordingAdapter(),
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => FIXED,
    modelLabel: "mock",
    ...over,
  };
}

// --- seed helpers -----------------------------------------------------------

/** Create a throwaway workspace, run the body, then cascade-delete it. */
async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `brain-cfg-${suffix}@10xconnect.test`,
    password: `Pw-${suffix}!`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    await db.destroy();
    throw created.error ?? new Error("failed to create seed user");
  }
  const userId = created.data.user.id;
  try {
    const ws = await db
      .insertInto("workspaces")
      .values({ name: `Brain Cfg ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("memberships")
      .values({ workspace_id: ws.id, user_id: userId, role: "owner" })
      .execute();
    await body({ db, workspaceId: ws.id });
  } finally {
    await admin.auth.admin.deleteUser(userId); // cascades away the workspace + scoped rows
    await db.destroy();
  }
}

async function seedAccount(db: Kysely<DB>, workspaceId: string): Promise<string> {
  const row = await db
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
  return row.id;
}

async function seedLead(db: Kysely<DB>, workspaceId: string): Promise<string> {
  const row = await db
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
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function seedKbWithDoc(
  db: Kysely<DB>,
  workspaceId: string,
  embedder: EmbeddingAdapter,
): Promise<string> {
  const kb = await db
    .insertInto("knowledge_bases")
    .values({ workspace_id: workspaceId, name: "Product KB" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await ingestText(db, embedder, { workspaceId, knowledgeBaseId: kb.id, text: KB_DOC, source: "doc" });
  return kb.id;
}

/** A draft campaign with NO brain unless `extra` adds objective/knowledge_base_id. */
async function seedCampaign(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string | null,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const row = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "Campaign",
      status: "running",
      ...(accountId ? { account_id: accountId } : {}),
      ...extra,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function seedActiveState(
  db: Kysely<DB>,
  workspaceId: string,
  campaignId: string,
  leadId: string,
): Promise<void> {
  await db
    .insertInto("lead_campaign_state")
    .values({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      lead_id: leadId,
      status: "active",
      history: JSON.stringify([]),
    })
    .execute();
}

async function seedConversation(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string,
  leadId: string,
  question: string,
): Promise<string> {
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
    .values({
      workspace_id: workspaceId,
      conversation_id: convo.id,
      direction: "inbound",
      channel: "linkedin",
      body: question,
    })
    .execute();
  return convo.id;
}

function replyEvent(accountId: string, leadId: string, body: string): InboundEvent {
  return {
    id: `evt-${randomUUID()}`,
    type: "reply",
    accountId,
    channel: "linkedin",
    occurredAt: FIXED.toISOString(),
    lead: { leadId },
    message: {
      providerMessageId: `m-${randomUUID()}`,
      direction: "inbound",
      body,
      sentAt: FIXED.toISOString(),
    },
  } as unknown as InboundEvent;
}

// --- 0. AI-OFF PREDICATE (pure) ---------------------------------------------

test("hasCampaignBrain ignores an empty objective so the AI-off indicator can't lie", () => {
  assert.equal(hasCampaignBrain({ objective: null, knowledgeBaseId: null }), false, "nothing set → off");
  assert.equal(hasCampaignBrain({ objective: {}, knowledgeBaseId: null }), false, "empty object → off");
  assert.equal(hasCampaignBrain({ objective: { goal: "" }, knowledgeBaseId: null }), false, "blank field → off");
  assert.equal(hasCampaignBrain({ objective: { goal: "   " }, knowledgeBaseId: null }), false, "whitespace → off");
  assert.equal(
    hasCampaignBrain({ objective: { goal: "book a demo" }, knowledgeBaseId: null }),
    true,
    "real aim → on",
  );
  assert.equal(hasCampaignBrain({ objective: null, knowledgeBaseId: "kb-1" }), true, "linked KB → on");
});

// --- 1. ROUND-TRIP ----------------------------------------------------------

test("brain config round-trips budget / limits / voice.samples / autonomy.threshold via the real BrainService", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const campaignId = await seedCampaign(db, workspaceId, null);
    const service = new BrainService(db, fakeAdapter);

    // The exact payload shapes the Context tab UI sends, one per card.
    const voicePayload = {
      voice: {
        tone: "warm, concise, peer-to-peer",
        samples: ["Hey Jordan — quick one.", "Saw your post on RevOps; how do you handle X today?"],
      },
    };
    const autonomyPayload = {
      autonomy: { mode: "auto_easy_escalate_hard" as const, confidence_threshold: 0.72 },
      limits: { max_ai_turns: 4, cooldown_minutes: 120 },
    };
    const budgetPayload = { budget: { daily_usd_cap: 25, alert_at_pct: 0.85 } };

    // The REAL validator accepts each card's payload (UI ↔ contract drift guard).
    assert.doesNotThrow(() => brainConfigSchema.parse(voicePayload), "voice payload validates");
    assert.doesNotThrow(() => brainConfigSchema.parse(autonomyPayload), "autonomy payload validates");
    assert.doesNotThrow(() => brainConfigSchema.parse(budgetPayload), "budget payload validates");

    // Save each slice INDEPENDENTLY (mirrors the per-card Save buttons) — a later
    // card's save must NOT clobber earlier ones (PUT merge semantics).
    await service.setBrain(workspaceId, campaignId, voicePayload);
    await service.setBrain(workspaceId, campaignId, autonomyPayload);
    await service.setBrain(workspaceId, campaignId, budgetPayload);

    // Reload via the REAL getBrain (save → reload round-trip).
    const got = await service.getBrain(workspaceId, campaignId);
    assert.deepEqual(got.voice, voicePayload.voice, "voice tone + samples round-trip");
    assert.deepEqual(got.autonomy, autonomyPayload.autonomy, "autonomy mode + threshold round-trip");
    assert.deepEqual(got.limits, autonomyPayload.limits, "limits max_ai_turns + cooldown round-trip");
    assert.deepEqual(got.budget, budgetPayload.budget, "budget cap + alert round-trip");

    // The budget governor's own view reads the configured cap + threshold back.
    const usage = await service.budgetUsage(workspaceId, campaignId);
    assert.equal(usage.cap, 25, "budget governor sees the configured daily cap");
    assert.equal(usage.alertAtPct, 0.85, "budget governor sees the alert threshold");

    // Clearing the cap (UI sends null) round-trips to uncapped without wiping siblings.
    await service.setBrain(workspaceId, campaignId, { budget: { daily_usd_cap: null } });
    const cleared = await service.getBrain(workspaceId, campaignId);
    assert.equal(
      (cleared.budget as { daily_usd_cap?: number | null }).daily_usd_cap,
      null,
      "cap clears to null",
    );
    assert.deepEqual(cleared.voice, voicePayload.voice, "voice survives a later budget save (merge)");
    assert.deepEqual(cleared.limits, autonomyPayload.limits, "limits survive a later budget save (merge)");
  });
});

// --- 2. HONORED: max_ai_turns -----------------------------------------------

test("backend honors max_ai_turns set via BrainService: handoff fires at the cap (no model call)", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const accountId = await seedAccount(db, workspaceId);
    const leadId = await seedLead(db, workspaceId);
    const kbId = await seedKbWithDoc(db, workspaceId, embedder);
    const campaignId = await seedCampaign(db, workspaceId, accountId, { knowledge_base_id: kbId });

    // Configure exactly as the UI would: aim + a 2-turn cap.
    await new BrainService(db, fakeAdapter).setBrain(workspaceId, campaignId, {
      objective: { goal: "book a demo" },
      limits: { max_ai_turns: 2 },
      autonomy: { mode: "approve_all" },
    });
    // The lead has already had 2 AI replies → the cap is reached.
    await db
      .insertInto("relationship_state")
      .values({ lead_id: leadId, workspace_id: workspaceId, campaign_id: campaignId, ai_turn_count: 2 })
      .execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "What's in the Pro plan?");

    const before = { ...counter };
    const outcome = await runConversationTurn(
      engineDeps(db, { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );

    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "max_turns");
    assert.equal(counter.text - before.text, 0, "no model call on a turn-cap handoff");

    const draft = await db
      .selectFrom("message_drafts")
      .select(["status"])
      .where("conversation_id", "=", convoId)
      .executeTakeFirstOrThrow();
    assert.equal(draft.status, "escalated", "thread escalated to a human at the cap");
  });
});

// --- 2. HONORED: per-contact cooldown ---------------------------------------

test("backend honors cooldown_minutes set via BrainService: a reply inside the window is skipped (no model call)", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const accountId = await seedAccount(db, workspaceId);
    const leadId = await seedLead(db, workspaceId);
    const kbId = await seedKbWithDoc(db, workspaceId, embedder);
    const campaignId = await seedCampaign(db, workspaceId, accountId, { knowledge_base_id: kbId });

    await new BrainService(db, fakeAdapter).setBrain(workspaceId, campaignId, {
      objective: { goal: "book a demo" },
      limits: { cooldown_minutes: 120 },
      autonomy: { mode: "approve_all" },
    });
    // The AI replied 10 minutes ago — well inside the 120-minute cooldown window.
    await db
      .insertInto("relationship_state")
      .values({
        lead_id: leadId,
        workspace_id: workspaceId,
        campaign_id: campaignId,
        ai_turn_count: 1,
        last_ai_reply_at: new Date(FIXED.getTime() - 10 * 60_000).toISOString(),
      })
      .execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "Quick question on the Pro plan?");

    const before = { ...counter };
    const outcome = await runConversationTurn(
      engineDeps(db, { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );

    assert.equal(outcome.status, "skipped");
    assert.equal((outcome as { reason: string }).reason, "cooldown");
    assert.equal(counter.text - before.text, 0, "no model call inside the cooldown window");

    const drafts = await db
      .selectFrom("message_drafts")
      .select("id")
      .where("conversation_id", "=", convoId)
      .execute();
    assert.equal(drafts.length, 0, "no draft written inside cooldown");
  });
});

// --- 2. HONORED: budget hard-stop -------------------------------------------

test("backend honors the USD budget cap set via BrainService: hard-stop drops autonomy to approve_all", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const counter = { text: 0, embed: 0 };
    const embedder = countingEmbedder(counter);
    const accountId = await seedAccount(db, workspaceId);
    const leadId = await seedLead(db, workspaceId);
    const kbId = await seedKbWithDoc(db, workspaceId, embedder);
    const campaignId = await seedCampaign(db, workspaceId, accountId, { knowledge_base_id: kbId });

    await new BrainService(db, fakeAdapter).setBrain(workspaceId, campaignId, {
      objective: { goal: "book a demo" },
      budget: { daily_usd_cap: 0.01 },
      autonomy: { mode: "auto_easy_escalate_hard" }, // must get dropped to approve_all
    });
    // Pre-spend today's budget so we're already over the cap.
    await db
      .insertInto("budget_ledger")
      .values({
        campaign_id: campaignId,
        window: utcDay(FIXED),
        workspace_id: workspaceId,
        tokens_used: 5000,
        usd_used: 0.02,
      })
      .execute();
    const convoId = await seedConversation(db, workspaceId, accountId, leadId, "How much is the Pro plan?");

    const before = { ...counter };
    const outcome = await runConversationTurn(
      engineDeps(db, { textAdapter: countingText(counter), embeddingAdapter: embedder }),
      { conversationId: convoId, campaignId, leadId },
    );

    assert.equal(outcome.status, "escalated");
    assert.equal((outcome as { reason: string }).reason, "budget_exceeded");
    assert.equal(counter.text - before.text, 0, "no spend once over budget");

    // The Phase 4 interlock: autonomy hard-dropped to approve_all.
    const after = await new BrainService(db, fakeAdapter).getBrain(workspaceId, campaignId);
    assert.equal(autonomyFrom(after.autonomy).mode, "approve_all", "autonomy dropped to approve_all");
  });
});

// --- 3. AI-OFF GATE (backs the indicator) -----------------------------------

test("inbound AI gate matches hasCampaignBrain: brain-less campaign skips the turn, a configured one enqueues it", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const service = new BrainService(db, fakeAdapter);
    const accountId = await seedAccount(db, workspaceId);

    // (a) Brain-less campaign: no objective, no KB → indicator ON, no AI turn.
    const leadOff = await seedLead(db, workspaceId);
    const campOff = await seedCampaign(db, workspaceId, accountId);
    await seedActiveState(db, workspaceId, campOff, leadOff);
    const brainOff = await service.getBrain(workspaceId, campOff);
    assert.equal(
      hasCampaignBrain({ objective: brainOff.objective, knowledgeBaseId: brainOff.knowledgeBaseId }),
      false,
      "brain-less campaign → AI off (indicator shows)",
    );
    await processInboundEvent({ db }, replyEvent(accountId, leadOff, "Sounds interesting, tell me more"));
    const turnOff = await db
      .selectFrom("actions")
      .select("id")
      .where("lead_id", "=", leadOff)
      .where("type", "=", "conversation_turn")
      .executeTakeFirst();
    assert.equal(turnOff, undefined, "no conversation turn enqueued for a brain-less campaign");

    // (b) Configure an aim via BrainService → indicator OFF, AI turn enqueued.
    const leadOn = await seedLead(db, workspaceId);
    const campOn = await seedCampaign(db, workspaceId, accountId);
    await service.setBrain(workspaceId, campOn, { objective: { goal: "book a demo" } });
    await seedActiveState(db, workspaceId, campOn, leadOn);
    const brainOn = await service.getBrain(workspaceId, campOn);
    assert.equal(
      hasCampaignBrain({ objective: brainOn.objective, knowledgeBaseId: brainOn.knowledgeBaseId }),
      true,
      "objective set → AI on (indicator gone)",
    );
    await processInboundEvent({ db }, replyEvent(accountId, leadOn, "Sounds interesting, tell me more"));
    const turnOn = await db
      .selectFrom("actions")
      .select("id")
      .where("lead_id", "=", leadOn)
      .where("type", "=", "conversation_turn")
      .executeTakeFirst();
    assert.ok(turnOn, "conversation turn enqueued once a brain is configured");
  });
});
