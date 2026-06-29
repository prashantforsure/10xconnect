// BATCH 5 Test Gate (DB-backed) — three backend gaps closed:
//   1. PROMPT CACHING (9.8): across turns the static prefix (system + objective)
//      repeats; a caching adapter bills it cheaper. We assert turn 2 logs cached
//      tokens AND a lower cost than the same usage priced as a cache miss.
//   2. SEND-CONDITION ENFORCEMENT + ATTACHMENTS (1.6): a "never_messaged" node is
//      SKIPPED when the recipient has already messaged, and SENDS (with media
//      delivered through the adapter) when they haven't.
//   3. ACTIVITY-VAR PROFILE-VISIT BUDGET (11.6): an activity-variable read charges
//      the profile-visit budget (governed + idempotent); a reached cap skips the read.
//   4. RESTRICTION → FE NOTIFICATION (BATCH 6 / 3.7): a simulated account restriction
//      auto-pauses the account AND writes an unread notification — the exact row the
//      FE accounts page reads via GET /notifications?unread=true to surface the pause.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ActionResult,
  type ChannelAdapter,
  type DailyCaps,
  defaultDailyCaps,
  EMBEDDING_DIM,
  type EmbeddingAdapter,
  type EnrichedProfile,
  estimateUsd,
  hashingEmbedding,
  type MessageAttachment,
  type TextGenerationAdapter,
} from "@10xconnect/core";

import { maybeChargeActivityProfileVisit } from "./activity-budget";
import { ingestText } from "./brain/kb";
import { runConversationTurn } from "./brain/turn";
import { utcDay } from "./brain/window";
import type { CampaignRow } from "./campaign-runner";
import { dispatchDueActions } from "./dispatch";
import { executeTransportAction } from "./executor";
import { flagAccountIncident } from "./restrictions";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps, LeadRow, SequenceNodeRow } from "./types";

const FIXED = new Date("2026-06-28T12:00:00.000Z");
// dispatchDueActions claims due actions GLOBALLY (no workspace filter) — the worker
// is one tick for the whole DB. The phase tests share the dev DB and run in parallel,
// so the send-condition tests dispatch on a deliberately OLD clock: their action is
// dated 2020 and only their 2020-clock dispatcher claims it, never the other suites'
// 2026-dated actions. Outcome assertions read the action's own final status, which is
// deterministic regardless of which parallel dispatcher happens to process it.
const EARLY = new Date("2020-06-28T12:00:00.000Z");
const WARMED = JSON.stringify({ phase: "active", startedAt: "2018-01-01T00:00:00.000Z" });

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

function embedder(): EmbeddingAdapter {
  return { dimension: EMBEDDING_DIM, embed: async (t: string) => hashingEmbedding(t) };
}

const est = (s: string): number => Math.ceil((s ?? "").length / 4);

/**
 * A caching text adapter (same shape as the real MockTextAdapter): a cache prefix
 * (system + cachePrefix) seen before this instance bills cached tokens on repeat.
 */
function cachingText(): TextGenerationAdapter {
  const seen = new Set<string>();
  return {
    generate: async () => "Sure — happy to help with that.",
    generateWithUsage: async (input) => {
      const cacheable = `${input.system ?? ""}\n${input.cachePrefix ?? ""}`;
      let cachedTokens = 0;
      if (cacheable.trim()) {
        if (seen.has(cacheable)) cachedTokens = est(cacheable);
        else seen.add(cacheable);
      }
      const text = "Happy to help — here are the details you asked about.";
      const promptTokens = est(`${cacheable}\n${input.prompt}`);
      const completionTokens = est(text);
      return {
        text,
        usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cachedTokens },
      };
    },
  };
}

// --- seed helpers -----------------------------------------------------------

async function seedAccount(db: EngineDeps["db"], workspaceId: string): Promise<string> {
  const row = await db
    .insertInto("sending_accounts")
    .values({
      workspace_id: workspaceId,
      type: "linkedin",
      connection_method: "extension",
      name: "Sender",
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

async function seedLead(db: EngineDeps["db"], workspaceId: string, enrichment: Record<string, unknown> = {}): Promise<{ id: string; url: string }> {
  const url = `https://linkedin.com/in/lead-${randomUUID()}`;
  const row = await db
    .insertInto("leads")
    .values({
      workspace_id: workspaceId,
      linkedin_url: url,
      enrichment: JSON.stringify({ firstName: "Jordan", ...enrichment }),
      tags: [],
      connection_degree: 1,
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, url };
}

// =====================================================================
// 1. PROMPT CACHING
// =====================================================================

test("prompt caching: a multi-turn conversation bills the static prefix cheaper on repeat", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const kb = await db
      .insertInto("knowledge_bases")
      .values({ workspace_id: workspaceId, name: "KB" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await ingestText(db, embedder(), {
      workspaceId,
      knowledgeBaseId: kb.id,
      text: "Pricing. Our Pro plan is $99 per month and includes priority support and the AI assistant.",
      source: "doc",
    });
    const campaign = await db
      .insertInto("campaigns")
      .values({
        workspace_id: workspaceId,
        name: "Brain",
        status: "running",
        account_id: accountId,
        objective: JSON.stringify({
          goal: "book a demo",
          offer: "an AI SDR that books meetings",
          success_criteria: "a booked call",
          cta: "a 15-minute intro call",
        }),
        knowledge_base_id: kb.id,
        autonomy: JSON.stringify({ mode: "approve_all" }),
        voice: JSON.stringify({ tone: "warm, concise, peer-to-peer", samples: ["hey — quick one for you"] }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Two separate conversations in the SAME campaign → identical static prefix
    // (system + objective). One shared adapter instance, so convo 2 hits the cache.
    const adapter = cachingText();
    const d = deps(db, {} as ChannelAdapter, { textAdapter: adapter, embeddingAdapter: embedder() });
    const convoIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const lead = await seedLead(db, workspaceId);
      const convo = await db
        .insertInto("conversations")
        .values({
          workspace_id: workspaceId,
          account_id: accountId,
          lead_id: lead.id,
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
          body: "Does the Pro plan include priority support?",
        })
        .execute();
      const outcome = await runConversationTurn(d, { conversationId: convo.id, campaignId: campaign.id, leadId: lead.id });
      assert.equal(outcome.status, "drafted", `turn ${i + 1} drafted`);
      convoIds.push(convo.id);
    }

    const usage1 = await db
      .selectFrom("llm_usage")
      .select(["prompt_tokens as p", "completion_tokens as c", "cached_tokens as cached", "usd"])
      .where("conversation_id", "=", convoIds[0])
      .where("kind", "=", "draft")
      .executeTakeFirstOrThrow();
    const usage2 = await db
      .selectFrom("llm_usage")
      .select(["prompt_tokens as p", "completion_tokens as c", "cached_tokens as cached", "usd"])
      .where("conversation_id", "=", convoIds[1])
      .where("kind", "=", "draft")
      .executeTakeFirstOrThrow();

    assert.equal(Number(usage1.cached), 0, "turn 1 is a cache miss (0 cached tokens)");
    assert.ok(Number(usage2.cached) > 0, "turn 2 reuses the cached prefix (cached tokens logged)");

    // The cost saving is real: turn 2's billed cost is LESS than the same tokens
    // priced as a full cache miss (cached tokens at the discounted rate).
    const freshEquivalent = estimateUsd(
      { promptTokens: Number(usage2.p), completionTokens: Number(usage2.c), totalTokens: 0, cachedTokens: 0 },
      "mock",
    );
    assert.ok(Number(usage2.usd) < freshEquivalent, "turn 2 costs less than it would without caching");

    // Rolled up onto the campaign/day budget ledger.
    const ledger = await db
      .selectFrom("budget_ledger")
      .select(["cached_tokens_used as cached"])
      .where("campaign_id", "=", campaign.id)
      .where("window", "=", utcDay(FIXED))
      .executeTakeFirstOrThrow();
    assert.ok(Number(ledger.cached) > 0, "campaign budget ledger records the cached tokens");
  } finally {
    await w.cleanup();
  }
});

// =====================================================================
// 2. SEND-CONDITION ENFORCEMENT + ATTACHMENT DELIVERY
// =====================================================================

interface SentMessage {
  key: string;
  body: string;
  attachments?: MessageAttachment[];
}
function captureAdapter(sink: SentMessage[]): ChannelAdapter {
  const ok = (idempotencyKey: string): ActionResult => ({ status: "success", idempotencyKey, at: EARLY.toISOString() });
  return {
    sendMessage: async (_a: unknown, _l: unknown, content: SentMessage, opts: { idempotencyKey: string }) => {
      sink.push({ key: opts.idempotencyKey, body: content.body, attachments: content.attachments });
      return ok(opts.idempotencyKey);
    },
    // Defensive: never throw if (despite the old clock) a foreign action is claimed.
    sendConnectionRequest: async (_a: unknown, _l: unknown, opts: { idempotencyKey: string }) => ok(opts.idempotencyKey),
  } as unknown as ChannelAdapter;
}

/** Dispatch (old clock) until the seeded action reaches a terminal status. */
async function dispatchUntilDone(d: EngineDeps, db: EngineDeps["db"], actionId: string): Promise<string> {
  for (let i = 0; i < 6; i += 1) {
    await dispatchDueActions(d);
    const a = await db.selectFrom("actions").select("status").where("id", "=", actionId).executeTakeFirstOrThrow();
    if (a.status !== "pending" && a.status !== "executing") return a.status;
  }
  const a = await db.selectFrom("actions").select("status").where("id", "=", actionId).executeTakeFirstOrThrow();
  return a.status;
}

async function seedSendMessageNode(
  db: EngineDeps["db"],
  workspaceId: string,
  accountId: string,
  config: Record<string, unknown>,
  opts: { withInbound: boolean },
): Promise<{ campaignId: string; actionId: string }> {
  const lead = await seedLead(db, workspaceId);
  const campaign = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "Send",
      status: "running",
      account_id: accountId,
      caps: JSON.stringify(defaultDailyCaps()),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const node = await db
    .insertInto("sequence_nodes")
    .values({
      workspace_id: workspaceId,
      campaign_id: campaign.id,
      kind: "action",
      type: "send_message",
      config: JSON.stringify(config),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("lead_campaign_state")
    .values({
      workspace_id: workspaceId,
      campaign_id: campaign.id,
      lead_id: lead.id,
      current_node_id: node.id,
      status: "active",
      history: JSON.stringify([]),
    })
    .execute();
  const action = await db
    .insertInto("actions")
    .values({
      workspace_id: workspaceId,
      account_id: accountId,
      lead_id: lead.id,
      campaign_id: campaign.id,
      node_id: node.id,
      type: "message",
      status: "pending",
      idempotency_key: `msg:${campaign.id}:${lead.id}:${node.id}:0`,
      scheduled_at: new Date(EARLY.getTime() - 60_000).toISOString(),
      config: JSON.stringify(config),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (opts.withInbound) {
    const convo = await db
      .insertInto("conversations")
      .values({ workspace_id: workspaceId, account_id: accountId, lead_id: lead.id, channel: "linkedin", pipeline_stage: "in_conversation" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("messages")
      .values({ workspace_id: workspaceId, conversation_id: convo.id, direction: "inbound", channel: "linkedin", body: "hey, saw your profile" })
      .execute();
  }
  return { campaignId: campaign.id, actionId: action.id };
}

const BODY = { v: 1 as const, segments: [{ type: "text" as const, text: "great to connect!" }] };

test("send condition: never_messaged SKIPS the send when the recipient already messaged", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const { actionId } = await seedSendMessageNode(
      db,
      workspaceId,
      accountId,
      { messageBody: BODY, sendCondition: { type: "never_messaged" } },
      { withInbound: true },
    );

    const status = await dispatchUntilDone(deps(db, captureAdapter([]), { now: () => EARLY }), db, actionId);

    assert.equal(status, "skipped", "action finalized as skipped — the recipient already messaged us");
    const act = await db.selectFrom("actions").select("result").where("id", "=", actionId).executeTakeFirstOrThrow();
    assert.match(JSON.stringify(act.result), /never_messaged/, "skip reason recorded");
  } finally {
    await w.cleanup();
  }
});

test("send condition: never_messaged SENDS when the recipient hasn't messaged", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const { actionId } = await seedSendMessageNode(
      db,
      workspaceId,
      accountId,
      { messageBody: BODY, sendCondition: { type: "never_messaged" } },
      { withInbound: false },
    );

    const status = await dispatchUntilDone(deps(db, captureAdapter([]), { now: () => EARLY }), db, actionId);

    assert.equal(status, "success", "action sent — the recipient has never messaged");
  } finally {
    await w.cleanup();
  }
});

test("attachment delivery: media on a send_message node is passed THROUGH the adapter", async () => {
  // Executor-level (no DB / no global queue) so it's deterministic + isolated.
  const sink: SentMessage[] = [];
  const attachment = {
    kind: "image",
    ref: `ws/camp/${randomUUID()}-pic.png`,
    name: "pic.png",
    mime: "image/png",
    url: "https://example.com/pic.png",
  };
  const lead = {
    id: "lead-1",
    workspace_id: "ws-1",
    linkedin_url: "https://linkedin.com/in/x",
    email: null,
    enrichment: { firstName: "Jo" },
    tags: [],
    custom_columns: {},
    connection_degree: 1,
  } as unknown as LeadRow;

  const result = await executeTransportAction({
    adapter: captureAdapter(sink),
    accountRef: { accountId: "acc-1" },
    leadRef: { leadId: "lead-1" },
    workspaceId: "ws-1",
    nodeType: "send_message",
    config: { messageBody: BODY, attachments: [attachment] },
    idempotencyKey: "att-1",
    lead,
  });

  assert.equal(result.status, "success", "send succeeded");
  assert.equal(sink.length, 1, "one message delivered through the adapter");
  assert.equal(sink[0].body, "great to connect!", "body rendered");
  assert.equal(sink[0].attachments?.length, 1, "attachment delivered THROUGH the adapter (Unipile supports media)");
  assert.equal(sink[0].attachments?.[0].ref, attachment.ref, "the right attachment was delivered");
  assert.equal(sink[0].attachments?.[0].url, attachment.url, "fetchable url forwarded to the transport");
});

// =====================================================================
// 4. RESTRICTION → FE NOTIFICATION SURFACING
// =====================================================================

test("a simulated restriction auto-pauses the account AND surfaces an unread FE notification", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);

    // Simulate the domain event the dispatch loop raises when the provider reports a
    // restriction (CLAUDE.md §2/§6) — the same call dispatch/inbound make.
    await flagAccountIncident(db, workspaceId, accountId, "restricted");

    // Account is auto-paused within the call: status → restricted, health floored.
    const acct = await db
      .selectFrom("sending_accounts")
      .select(["status", "health_score"])
      .where("id", "=", accountId)
      .executeTakeFirstOrThrow();
    assert.equal(acct.status, "restricted", "account auto-paused/restricted");
    assert.ok(Number(acct.health_score) <= 10, "health dropped to the floor");

    // The FE accounts page reads GET /notifications?unread=true — exactly this query.
    // The incident must be present, unread, and linked to the account so the UI can
    // render the pause (title + remediation body).
    const unread = await db
      .selectFrom("notifications")
      .select(["type", "title", "body", "account_id", "read"])
      .where("workspace_id", "=", workspaceId)
      .where("read", "=", false)
      .orderBy("created_at", "desc")
      .execute();
    assert.equal(unread.length, 1, "one unread notification surfaced for the FE");
    assert.equal(unread[0].type, "account_restricted");
    assert.equal(unread[0].account_id, accountId, "linked to the restricted account");
    assert.equal(unread[0].read, false, "starts unread so the FE shows it");
    assert.ok((unread[0].title ?? "").length > 0, "human-readable title");
    assert.ok((unread[0].body ?? "").length > 0, "remediation guidance in the body");
  } finally {
    await w.cleanup();
  }
});

// =====================================================================
// 3. ACTIVITY-VAR PROFILE-VISIT BUDGET
// =====================================================================

function profileAdapter(reads: { count: number }): ChannelAdapter {
  return {
    fetchProfile: async (_a: unknown, linkedinUrl: string): Promise<EnrichedProfile> => {
      reads.count += 1;
      return {
        linkedinUrl,
        firstName: "Jordan",
        recentPosts: [{ postId: "p1", text: "We just shipped a new onboarding flow.", postedAt: FIXED.toISOString() }],
      } as EnrichedProfile;
    },
  } as unknown as ChannelAdapter;
}

async function visitProfileCount(db: EngineDeps["db"], accountId: string): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .where("account_id", "=", accountId)
    .where("type", "=", "visit_profile")
    .where("status", "=", "success")
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

test("activity-var read charges the profile-visit budget (governed + idempotent)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const leadRow = await seedLead(db, workspaceId);
    const campaign = await db
      .insertInto("campaigns")
      .values({ workspace_id: workspaceId, name: "Act", status: "running", account_id: accountId })
      .returning("id")
      .executeTakeFirstOrThrow();
    // A node whose body uses an ACTIVITY variable (lastPost).
    const nodeId = (
      await db
        .insertInto("sequence_nodes")
        .values({
          workspace_id: workspaceId,
          campaign_id: campaign.id,
          kind: "action",
          type: "send_message",
          config: JSON.stringify({
            messageBody: { v: 1, segments: [{ type: "text", text: "saw " }, { type: "variable", key: "lastPost" }] },
          }),
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;

    const baseCaps: DailyCaps = defaultDailyCaps();
    const campaignRow = { id: campaign.id, workspace_id: workspaceId } as CampaignRow;
    const node = {
      id: nodeId,
      campaign_id: campaign.id,
      workspace_id: workspaceId,
      kind: "action",
      type: "send_message",
      config: { messageBody: { v: 1, segments: [{ type: "text", text: "saw " }, { type: "variable", key: "lastPost" }] } },
      next_node_id: null,
      true_node_id: null,
      false_node_id: null,
      delay_days: null,
    } as unknown as SequenceNodeRow;
    const makeLead = (enrichment: Record<string, unknown>): LeadRow =>
      ({
        id: leadRow.id,
        workspace_id: workspaceId,
        linkedin_url: leadRow.url,
        email: null,
        enrichment,
        tags: [],
        custom_columns: {},
        connection_degree: 1,
      }) as unknown as LeadRow;

    const reads = { count: 0 };
    const d = deps(db, profileAdapter(reads));
    const baseInput = { accountRef: { accountId }, campaign: campaignRow, node, baseCaps, accountAgeDays: 1000, now: FIXED };

    // Stale/absent activity → a read is needed → charge a profile visit.
    const r1 = await maybeChargeActivityProfileVisit(d, { ...baseInput, lead: makeLead({}) });
    assert.equal(r1.charged, true, "charged a profile visit for the activity read");
    assert.equal(r1.reason, "charged");
    assert.equal(reads.count, 1, "the profile was actually read");
    assert.equal(await visitProfileCount(db, accountId), 1, "visit_profile budget counter incremented");

    // Idempotent: same account+lead+node+day → no double charge.
    const r2 = await maybeChargeActivityProfileVisit(d, { ...baseInput, lead: makeLead({}) });
    assert.equal(r2.charged, false);
    assert.equal(r2.reason, "already_charged");
    assert.equal(await visitProfileCount(db, accountId), 1, "still only one charge");

    // Fresh activity → no read, no charge.
    const r3 = await maybeChargeActivityProfileVisit(d, { ...baseInput, lead: makeLead({ enrichedAt: FIXED.toISOString(), recentPosts: [{ text: "hi" }] }) });
    assert.equal(r3.charged, false);
    assert.equal(r3.reason, "fresh");

    // Cap reached → the read is SKIPPED (variable renders empty; message still sends).
    const r4 = await maybeChargeActivityProfileVisit(d, {
      ...baseInput,
      lead: makeLead({}),
      baseCaps: { ...baseCaps, visit_profile: 0 },
    });
    assert.equal(r4.charged, false);
    assert.equal(r4.reason, "cap_reached");
    assert.equal(await visitProfileCount(db, accountId), 1, "no charge when the profile-visit cap is reached");
  } finally {
    await w.cleanup();
  }
});
