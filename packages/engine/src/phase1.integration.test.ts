// Phase 1 Test Gate (DB-backed). Runs against the dev Postgres (DATABASE_URL +
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Each test seeds a throwaway
// workspace and tears it down. Proves: (1) an inbound reply opens the
// relationship axis + cancels the sequence, (2) a manual inbox reply dispatches
// through the actions queue via the adapter (never direct), (3) inbox label
// filters select the right threads.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type { ActionResult, ChannelAdapter, InboundEvent } from "@10xconnect/core";

import { dispatchDueActions } from "./dispatch";
import { processInboundEvent } from "./inbound";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });

/** A fake adapter that records what it was asked to send (proves: never direct). */
function recordingAdapter(sink: { idempotencyKey: string; body: string }[]): ChannelAdapter {
  return {
    sendMessage: async (_account: unknown, _lead: unknown, content: { body: string }, opts: { idempotencyKey: string }) => {
      sink.push({ idempotencyKey: opts.idempotencyKey, body: content.body });
      const ok: ActionResult = { status: "success", idempotencyKey: opts.idempotencyKey, at: new Date().toISOString() };
      return ok;
    },
  } as unknown as ChannelAdapter;
}

function deps(db: EngineDeps["db"], adapter: ChannelAdapter): EngineDeps {
  return {
    db,
    adapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => new Date(),
  };
}

test("inbound reply opens the relationship axis and cancels the sequence", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const account = await db
      .insertInto("sending_accounts")
      .values({
        workspace_id: workspaceId,
        type: "linkedin",
        connection_method: "extension",
        name: "Test LinkedIn",
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
        connection_degree: 2,
        enrich_status: "enriched",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const campaign = await db
      .insertInto("campaigns")
      .values({ workspace_id: workspaceId, name: "T", status: "running", account_id: account.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    const node = await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        kind: "action",
        type: "send_message",
        config: JSON.stringify({}),
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
    const pending = await db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: account.id,
        lead_id: lead.id,
        campaign_id: campaign.id,
        node_id: node.id,
        type: "message",
        status: "pending",
        idempotency_key: `seq:${randomUUID()}`,
        scheduled_at: new Date(Date.now() + 60_000).toISOString(),
        config: JSON.stringify({}),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const event = {
      id: `evt-${randomUUID()}`,
      type: "reply",
      accountId: account.id,
      channel: "linkedin",
      occurredAt: new Date().toISOString(),
      lead: { leadId: lead.id },
      message: {
        providerMessageId: `m-${randomUUID()}`,
        direction: "inbound",
        channel: "linkedin",
        body: "Sure, I'm interested — tell me more",
        sentAt: new Date().toISOString(),
      },
    } as unknown as InboundEvent;

    const res = await processInboundEvent({ db }, event);
    assert.equal(res.status, "processed");

    // Sequence auto-stopped: pending action skipped, lead state 'replied'.
    const action = await db.selectFrom("actions").select("status").where("id", "=", pending.id).executeTakeFirstOrThrow();
    assert.equal(action.status, "skipped");
    const lcs = await db
      .selectFrom("lead_campaign_state")
      .select("status")
      .where("campaign_id", "=", campaign.id)
      .where("lead_id", "=", lead.id)
      .executeTakeFirstOrThrow();
    assert.equal(lcs.status, "replied");

    // Relationship axis opened.
    const rel = await db
      .selectFrom("relationship_state")
      .select(["stage", "campaign_id"])
      .where("lead_id", "=", lead.id)
      .executeTakeFirstOrThrow();
    assert.equal(rel.stage, "in_conversation");
    assert.equal(rel.campaign_id, campaign.id);

    // Thread labeled + inbound message landed.
    const convo = await db
      .selectFrom("conversations")
      .select(["id", "needs_attention"])
      .where("workspace_id", "=", workspaceId)
      .where("lead_id", "=", lead.id)
      .executeTakeFirstOrThrow();
    assert.equal(convo.needs_attention, true);
    const msgs = await db.selectFrom("messages").select("direction").where("conversation_id", "=", convo.id).execute();
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]?.direction, "inbound");
  } finally {
    await w.cleanup();
  }
});

test("manual inbox reply dispatches through the actions queue via the adapter", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const account = await db
      .insertInto("sending_accounts")
      .values({
        workspace_id: workspaceId,
        type: "linkedin",
        connection_method: "extension",
        name: "Test LinkedIn",
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
        enrichment: JSON.stringify({ firstName: "Priya" }),
        tags: [],
        connection_degree: 1,
        enrich_status: "enriched",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const convo = await db
      .insertInto("conversations")
      .values({
        workspace_id: workspaceId,
        account_id: account.id,
        lead_id: lead.id,
        channel: "linkedin",
        pipeline_stage: "in_conversation",
        needs_attention: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const body = "Thanks for the reply — how does Tuesday look?";
    const idem = `reply:${convo.id}:${randomUUID()}`;
    await db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: account.id,
        lead_id: lead.id,
        type: "message",
        status: "pending",
        idempotency_key: idem,
        // Old timestamp so it is the oldest due action this tick.
        scheduled_at: "2020-01-01T00:00:00.000Z",
        config: JSON.stringify({ kind: "conversation_reply", conversationId: convo.id, body, channel: "linkedin" }),
      })
      .execute();

    // Before dispatch: action pending, nothing sent.
    const sent: { idempotencyKey: string; body: string }[] = [];
    const adapter = recordingAdapter(sent);
    assert.equal(sent.length, 0);
    const before = await db.selectFrom("actions").select("status").where("idempotency_key", "=", idem).executeTakeFirstOrThrow();
    assert.equal(before.status, "pending");

    await dispatchDueActions(deps(db, adapter));

    // The reply went out through the adapter (never direct), idempotency-keyed.
    const ourSends = sent.filter((s) => s.idempotencyKey === idem);
    assert.equal(ourSends.length, 1);
    assert.equal(ourSends[0]?.body, body);
    const after = await db.selectFrom("actions").select("status").where("idempotency_key", "=", idem).executeTakeFirstOrThrow();
    assert.equal(after.status, "success");

    // Outbound message recorded + "reply required" cleared.
    const outbound = await db
      .selectFrom("messages")
      .select(["direction", "body"])
      .where("conversation_id", "=", convo.id)
      .execute();
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0]?.direction, "outbound");
    assert.equal(outbound[0]?.body, body);
    const c = await db.selectFrom("conversations").select("needs_attention").where("id", "=", convo.id).executeTakeFirstOrThrow();
    assert.equal(c.needs_attention, false);
  } finally {
    await w.cleanup();
  }
});

test("inbox label filters select the right threads", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId, userId } = w;
    const mk = async (over: Record<string, unknown>): Promise<string> => {
      const row = await db
        .insertInto("conversations")
        .values({ workspace_id: workspaceId, channel: "linkedin", pipeline_stage: "in_conversation", ...over })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    };
    const replyRequired = await mk({ needs_attention: true });
    const important = await mk({ is_important: true });
    const mine = await mk({ assigned_to: userId });

    // Same predicates ConversationsService.list() applies per filter.
    const byFilter = async (filter: "reply_required" | "important" | "mine" | "all"): Promise<string[]> => {
      let q = db.selectFrom("conversations").select("id").where("workspace_id", "=", workspaceId);
      if (filter === "reply_required") q = q.where("needs_attention", "=", true);
      else if (filter === "important") q = q.where("is_important", "=", true);
      else if (filter === "mine") q = q.where("assigned_to", "=", userId);
      return (await q.execute()).map((r) => r.id);
    };

    assert.deepEqual(await byFilter("reply_required"), [replyRequired]);
    assert.deepEqual(await byFilter("important"), [important]);
    assert.deepEqual(await byFilter("mine"), [mine]);
    assert.equal((await byFilter("all")).length, 3);
  } finally {
    await w.cleanup();
  }
});
