// Live sequence-edit contract (DB-backed) — the P0 fix from the campaign UX
// audit ("launched = frozen"). A running/paused campaign accepts CONTENT-only
// saves (identical node set/types/edges; new config or wait durations) as an
// in-place update that PRESERVES node ids — leads parked on nodes never strand.
// Structural changes (add/remove/re-wire/re-type steps) are rejected with a
// clear "stop first" message. Also covers the forward-visibility dispatch queue
// (GET /campaigns/:id/upcoming): pending actions only, soonest first.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { EngineDeps } from "@10xconnect/engine";
import type { Kysely } from "kysely";

import { CampaignRunService } from "./campaigns/campaign-run.service";
import { CampaignsService } from "./campaigns/campaigns.service";
import type { SaveSequenceDto } from "./campaigns/dto";

function engineDeps(db: Kysely<DB>): EngineDeps {
  // saveSequence/upcoming only touch this.db + this.campaigns — the rest is unused here.
  return {
    db,
    adapter: {} as never,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
  } as unknown as EngineDeps;
}

async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `live-edit-${suffix}@10xconnect.test`,
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
      .values({ name: `Live edit ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("memberships")
      .values({ workspace_id: ws.id, user_id: userId, role: "owner" })
      .execute();
    await body({ db, workspaceId: ws.id });
  } finally {
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  }
}

async function seedCampaign(db: Kysely<DB>, workspaceId: string): Promise<string> {
  const row = await db
    .insertInto("campaigns")
    .values({ workspace_id: workspaceId, name: "Live edit", status: "draft" })
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
      enrichment: JSON.stringify({ firstName: "Jordan", lastName: "Lee" }),
      tags: [],
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** connect → wait 2d → message ("hello v1"), builder-style local ids. */
const DRAFT_GRAPH: SaveSequenceDto = {
  nodes: [
    { id: "a", kind: "action", type: "send_connection_request", config: {}, next: "w", true: null, false: null, delayDays: null },
    { id: "w", kind: "action", type: "wait_x_days", config: { days: 2 }, next: "b", true: null, false: null, delayDays: 2 },
    { id: "b", kind: "action", type: "send_message", config: { body: "hello v1" }, next: null, true: null, false: null, delayDays: null },
  ],
};

test("live campaigns accept content-only saves in place (ids preserved) and reject structural edits", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const run = new CampaignRunService(db, engineDeps(db), new CampaignsService(db));
    const campaignId = await seedCampaign(db, workspaceId);

    // Draft save = full replace with id remap (unchanged behavior).
    const saved = await run.saveSequence(workspaceId, campaignId, DRAFT_GRAPH);
    assert.equal(saved.nodes.length, 3);
    const messageId = saved.nodes.find((n) => n.type === "send_message")?.id as string;
    const savedIds = saved.nodes.map((n) => n.id).sort();

    // Park a lead mid-sequence and flip the campaign live.
    const leadId = await seedLead(db, workspaceId);
    await db
      .insertInto("lead_campaign_state")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaignId,
        lead_id: leadId,
        status: "active",
        current_node_id: messageId,
        history: JSON.stringify([]),
      })
      .execute();
    await db.updateTable("campaigns").set({ status: "running" }).where("id", "=", campaignId).execute();

    // CONTENT-only edit (new message body + longer wait, same nodes/edges) → allowed.
    const contentEdit: SaveSequenceDto = {
      nodes: saved.nodes.map((n) => {
        if (n.type === "send_message") return { ...n, config: { body: "hello v2" } };
        if (n.type === "wait_x_days") return { ...n, config: { days: 5 }, delayDays: 5 };
        return n;
      }),
    };
    const after = await run.saveSequence(workspaceId, campaignId, contentEdit);
    assert.deepEqual(after.nodes.map((n) => n.id).sort(), savedIds, "node ids preserved (in-place update)");
    assert.equal(after.nodes.find((n) => n.type === "send_message")?.config.body, "hello v2", "body updated");
    assert.equal(after.nodes.find((n) => n.type === "wait_x_days")?.delayDays, 5, "wait duration updated");
    const parked = await db
      .selectFrom("lead_campaign_state")
      .select("current_node_id")
      .where("campaign_id", "=", campaignId)
      .where("lead_id", "=", leadId)
      .executeTakeFirstOrThrow();
    assert.equal(parked.current_node_id, messageId, "parked lead still points at a live node");

    // STRUCTURAL edits are rejected while live: append a step…
    const appended: SaveSequenceDto = {
      nodes: [
        ...contentEdit.nodes.map((n) => (n.type === "send_message" ? { ...n, next: "x" } : n)),
        { id: "x", kind: "action", type: "like_last_post", config: {}, next: null, true: null, false: null, delayDays: null },
      ],
    };
    await assert.rejects(run.saveSequence(workspaceId, campaignId, appended), /stop the campaign/i);
    // …remove the tail step…
    const removed: SaveSequenceDto = {
      nodes: contentEdit.nodes
        .filter((n) => n.type !== "send_message")
        .map((n) => (n.type === "wait_x_days" ? { ...n, next: null } : n)),
    };
    await assert.rejects(run.saveSequence(workspaceId, campaignId, removed), /stop the campaign/i);
    // …or change a step's action type.
    const retyped: SaveSequenceDto = {
      nodes: contentEdit.nodes.map((n) => (n.type === "send_message" ? { ...n, type: "inmail" } : n)),
    };
    await assert.rejects(run.saveSequence(workspaceId, campaignId, retyped), /stop the campaign/i);

    // Paused campaigns take content-only edits too (same in-flight rule).
    await db.updateTable("campaigns").set({ status: "paused" }).where("id", "=", campaignId).execute();
    const pausedEdit: SaveSequenceDto = {
      nodes: contentEdit.nodes.map((n) =>
        n.type === "send_message" ? { ...n, config: { body: "hello v3" } } : n,
      ),
    };
    const afterPaused = await run.saveSequence(workspaceId, campaignId, pausedEdit);
    assert.equal(afterPaused.nodes.find((n) => n.type === "send_message")?.config.body, "hello v3");

    // Stopped unlocks full structural replace again.
    await db.updateTable("campaigns").set({ status: "stopped" }).where("id", "=", campaignId).execute();
    const replaced = await run.saveSequence(workspaceId, campaignId, DRAFT_GRAPH);
    assert.equal(replaced.nodes.length, 3, "full replace allowed once stopped");
  });
});

test("upcoming returns only pending actions, soonest first, with lead names", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const run = new CampaignRunService(db, engineDeps(db), new CampaignsService(db));
    const campaignId = await seedCampaign(db, workspaceId);
    const leadId = await seedLead(db, workspaceId);

    const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
    const insert = (type: string, status: string, scheduledAt: string) =>
      db
        .insertInto("actions")
        .values({
          workspace_id: workspaceId,
          campaign_id: campaignId,
          lead_id: leadId,
          type,
          status,
          idempotency_key: `up-${randomUUID()}`,
          scheduled_at: scheduledAt,
        })
        .execute();
    await insert("send_message", "pending", at(20));
    await insert("send_connection_request", "pending", at(5));
    await insert("visit_profile", "success", at(-10)); // executed — must not appear

    const res = await run.upcoming(workspaceId, campaignId);
    assert.equal(res.total, 2, "only pending actions counted");
    assert.deepEqual(
      res.actions.map((a) => a.type),
      ["send_connection_request", "send_message"],
      "soonest first",
    );
    assert.equal(res.actions[0].lead, "Jordan Lee", "lead name rendered from enrichment");
  });
});
