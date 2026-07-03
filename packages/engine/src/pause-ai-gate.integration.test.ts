// Full-silence pause gate (audit P1-8): a paused campaign with
// settings.pause_ai_replies DEFERS AI conversation work at dispatch (requeued
// pending, never skipped — resume lets the AI catch up), while human-approved
// replies always send and the default pause (flag unset) keeps the AI answering.
//
// DISPATCH-DRIVEN, so it is date-isolated per the global-claim convention: the
// clock is 2001 and every action here is scheduled in 2000 — no other test's
// actions are due that far back, and ours are invisible to their clocks.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { type ChannelAdapter } from "@10xconnect/core";

import { dispatchDueActions } from "./dispatch";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const OLD_NOW = new Date("2001-01-01T12:00:00.000Z");
const OLD_DUE = "2000-12-31T00:00:00.000Z";

function deps(db: EngineDeps["db"]): EngineDeps {
  return {
    db,
    adapter: {} as ChannelAdapter, // gate fires before any transport call
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => OLD_NOW,
    modelLabel: "mock",
  };
}

async function seedPausedCampaign(
  db: EngineDeps["db"],
  workspaceId: string,
  opts: { pauseAi: boolean; status?: string },
): Promise<string> {
  const row = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "AI gate",
      status: (opts.status ?? "paused") as never,
      settings: JSON.stringify({ pause_ai_replies: opts.pauseAi }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function seedConversationAction(
  db: EngineDeps["db"],
  workspaceId: string,
  campaignId: string,
  config: Record<string, unknown>,
): Promise<string> {
  const row = await db
    .insertInto("actions")
    .values({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      type: "message",
      status: "pending",
      idempotency_key: `ai-gate-${randomUUID()}`,
      scheduled_at: OLD_DUE,
      config: JSON.stringify(config),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const actionRow = async (db: EngineDeps["db"], id: string) =>
  db
    .selectFrom("actions")
    .select(["status", "scheduled_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

/**
 * Wait out the transient 'executing' state: a concurrent test file's dispatcher
 * may hold a claim on this action for a moment before the gate requeues it.
 */
async function settledRow(db: EngineDeps["db"], id: string) {
  for (let i = 0; i < 30; i += 1) {
    const row = await actionRow(db, id);
    if (row.status !== "executing") return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return actionRow(db, id);
}

test("paused + pause_ai_replies defers AI conversation work; human replies and default pause still flow", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const d = deps(db);

    const silenced = await seedPausedCampaign(db, workspaceId, { pauseAi: true });
    const defaultPaused = await seedPausedCampaign(db, workspaceId, { pauseAi: false });

    // On the silenced campaign: an AI turn, an AI-authored reply, a human reply.
    const turnId = await seedConversationAction(db, workspaceId, silenced, {
      kind: "conversation_turn",
      conversationId: randomUUID(),
      campaignId: silenced,
    });
    const aiReplyId = await seedConversationAction(db, workspaceId, silenced, {
      kind: "conversation_reply",
      conversationId: randomUUID(),
      body: "auto reply",
      authoredBy: "ai",
    });
    const humanReplyId = await seedConversationAction(db, workspaceId, silenced, {
      kind: "conversation_reply",
      conversationId: randomUUID(),
      body: "human reply",
      authoredBy: "human",
    });
    // On the default-paused campaign (flag false): an AI turn — current behavior.
    const defaultTurnId = await seedConversationAction(db, workspaceId, defaultPaused, {
      kind: "conversation_turn",
      conversationId: randomUUID(),
      campaignId: defaultPaused,
    });

    // Assert on ROWS, not stats: a concurrently-running test's dispatcher (2026
    // clock) may legally claim these year-2000 actions first — the gate produces
    // the same row outcome either way, but the held count would land in ITS stats.
    await dispatchDueActions(d);

    // Silenced: the AI turn and AI-authored reply stay PENDING (requeued into the
    // future, not skipped — nothing is lost) …
    for (const id of [turnId, aiReplyId]) {
      const row = await settledRow(db, id);
      assert.equal(row.status, "pending", "deferred action stays pending");
      assert.ok(
        new Date(row.scheduled_at as unknown as string).getTime() > OLD_NOW.getTime(),
        "deferred action was pushed past now (won't spin every tick)",
      );
    }
    // … while the HUMAN-approved reply was processed (a person pressed send —
    // it leaves pending even though its fake conversation makes it skip/fail).
    assert.notEqual((await settledRow(db, humanReplyId)).status, "pending", "human reply not held");
    // Default pause (flag unset/false): AI work still flows — behavior unchanged.
    assert.notEqual((await settledRow(db, defaultTurnId)).status, "pending", "default pause does not hold AI");

    // Resume: flip to running → the deferred turn becomes dispatchable again.
    // Reset its due time explicitly (a concurrent test's dispatcher may have
    // requeued it far into ITS future) so our 2001 clock can claim it.
    await db.updateTable("campaigns").set({ status: "running" }).where("id", "=", silenced).execute();
    await db.updateTable("actions").set({ scheduled_at: OLD_DUE }).where("id", "=", turnId).where("status", "=", "pending").execute();
    await dispatchDueActions(d);
    assert.notEqual((await settledRow(db, turnId)).status, "pending", "released after resume");
  } finally {
    await w.cleanup();
  }
});
