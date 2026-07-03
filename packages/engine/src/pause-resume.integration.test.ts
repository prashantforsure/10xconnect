// Pause/resume lifecycle (DB-backed) — pause freezes a running campaign in place
// (cancels queued sequence actions, preserves each lead's position); resume flips
// back to running and re-schedules each lead from its current node with a FRESH
// action (no ON CONFLICT collision with the paused/skipped one). Distinct from
// stop, which is terminal. Guards: only running→pause, only paused→resume.
//
// No dispatchDueActions here — assertions read campaign/action/lead-state rows
// directly, so this suite is immune to the global-claim cross-test flakiness.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { type ChannelAdapter, defaultDailyCaps } from "@10xconnect/core";

import { pauseCampaign, resumeCampaign, startCampaign } from "./campaign-runner";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const FIXED = new Date("2026-07-03T12:00:00.000Z");
const WARMED = JSON.stringify({ phase: "active", startedAt: "2018-01-01T00:00:00.000Z" });

function deps(db: EngineDeps["db"]): EngineDeps {
  return {
    db,
    adapter: {} as ChannelAdapter, // never called — we don't dispatch here
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => FIXED,
    modelLabel: "mock",
  };
}

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

async function seedLead(db: EngineDeps["db"], workspaceId: string): Promise<string> {
  const row = await db
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
  return row.id;
}

/** A draft campaign with one linear connection-request node + N enrolled leads. */
async function seedCampaign(db: EngineDeps["db"], workspaceId: string, accountId: string, leadCount: number) {
  const campaign = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "Pause/Resume",
      status: "draft",
      account_id: accountId,
      caps: JSON.stringify(defaultDailyCaps()),
      // approve_all so the grounding gate (KB required for auto-reply) doesn't block start.
      autonomy: JSON.stringify({ mode: "approve_all" }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const node = await db
    .insertInto("sequence_nodes")
    .values({
      workspace_id: workspaceId,
      campaign_id: campaign.id,
      kind: "action",
      type: "send_connection_request",
      config: JSON.stringify({}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const leadIds: string[] = [];
  for (let i = 0; i < leadCount; i += 1) {
    const leadId = await seedLead(db, workspaceId);
    leadIds.push(leadId);
    await db
      .insertInto("lead_campaign_state")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        lead_id: leadId,
        status: "active",
        history: JSON.stringify([]),
      })
      .execute();
  }
  return { campaignId: campaign.id, nodeId: node.id, leadIds };
}

const pendingCount = async (db: EngineDeps["db"], campaignId: string): Promise<number> =>
  Number(
    (
      await db
        .selectFrom("actions")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("campaign_id", "=", campaignId)
        .where("status", "=", "pending")
        .executeTakeFirstOrThrow()
    ).c,
  );

const statusOf = async (db: EngineDeps["db"], campaignId: string): Promise<string> =>
  (
    await db.selectFrom("campaigns").select("status").where("id", "=", campaignId).executeTakeFirstOrThrow()
  ).status;

test("pause freezes a running campaign in place; resume re-queues each lead from its node", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const d = deps(db);
    const accountId = await seedAccount(db, workspaceId);
    const { campaignId, nodeId } = await seedCampaign(db, workspaceId, accountId, 2);

    // Start → running, one pending action per lead, each parked on the root node.
    const started = await startCampaign(d, workspaceId, campaignId);
    assert.equal(started.scheduled, 2, "both leads scheduled at start");
    assert.equal(await statusOf(db, campaignId), "running");
    assert.equal(await pendingCount(db, campaignId), 2, "one pending action per lead");

    // Pause → paused, queued actions cancelled, positions preserved.
    await pauseCampaign(d, workspaceId, campaignId);
    assert.equal(await statusOf(db, campaignId), "paused", "campaign is paused");
    assert.equal(await pendingCount(db, campaignId), 0, "no pending actions while paused");
    const skipped = Number(
      (
        await db
          .selectFrom("actions")
          .select((eb) => eb.fn.countAll<string>().as("c"))
          .where("campaign_id", "=", campaignId)
          .where("status", "=", "skipped")
          .executeTakeFirstOrThrow()
      ).c,
    );
    assert.equal(skipped, 2, "the queued actions were cancelled (skipped)");
    const parked = await db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("campaign_id", "=", campaignId)
      .where("current_node_id", "=", nodeId)
      .where("status", "=", "active")
      .executeTakeFirstOrThrow();
    assert.equal(Number(parked.c), 2, "leads keep their position (still parked on the node)");

    // Resume → running, one FRESH pending action per lead (no ON CONFLICT swallow).
    const resumed = await resumeCampaign(d, workspaceId, campaignId);
    assert.equal(resumed.scheduled, 2, "both leads re-queued on resume");
    assert.equal(await statusOf(db, campaignId), "running", "campaign runs again");
    assert.equal(await pendingCount(db, campaignId), 2, "each lead has exactly one fresh pending action");
  } finally {
    await w.cleanup();
  }
});

test("pause/resume guards: only running can pause, only paused can resume", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const d = deps(db);
    const accountId = await seedAccount(db, workspaceId);
    const { campaignId } = await seedCampaign(db, workspaceId, accountId, 1);

    // Draft campaign — can't pause or resume.
    await assert.rejects(() => pauseCampaign(d, workspaceId, campaignId), /Only a running campaign can be paused/);
    await assert.rejects(() => resumeCampaign(d, workspaceId, campaignId), /Only a paused campaign can be resumed/);

    await startCampaign(d, workspaceId, campaignId);
    // Running — can't resume (already running); a second pause after pausing throws.
    await assert.rejects(() => resumeCampaign(d, workspaceId, campaignId), /Only a paused campaign can be resumed/);
    await pauseCampaign(d, workspaceId, campaignId);
    await assert.rejects(() => pauseCampaign(d, workspaceId, campaignId), /Only a running campaign can be paused/);
  } finally {
    await w.cleanup();
  }
});
