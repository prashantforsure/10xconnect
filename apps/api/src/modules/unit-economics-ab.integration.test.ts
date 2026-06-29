// Test gate for BATCH 4 — surface unit economics + duplicate/A-B (render existing
// backends, extended for per-campaign cost).
//
// Drives the REAL AnalyticsService + CampaignRunService against the dev Postgres —
// the exact methods the controllers call (GET /analytics/unit-economics,
// GET /analytics/campaign/:id/unit-economics, POST /campaigns/:id/duplicate,
// POST /campaigns/ab-compare) — so the numbers the UI renders are real, not mocked.
//
// Proves:
//   1. UNIT ECON   — workspace (overall) AND per-campaign cost-per-conversation /
//      cost-per-booked-meeting compute from real budget_ledger spend ÷ conversation
//      outcomes; per-campaign scoping is genuine (campaign A ≠ workspace totals).
//   2. DUPLICATE   — duplicate clones the STRUCTURE into a fresh draft with 0 contacts,
//      KEEPING the account binding (unlike a workflow template).
//   3. A/B COMPARE — both campaigns come back with funnel metrics AND the folded-in
//      unit economics (spend + cost-per-booked-meeting per campaign).
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { EngineDeps } from "@10xconnect/engine";
import type { Kysely } from "kysely";

import { AnalyticsService } from "./analytics.module";
import { CampaignRunService } from "./campaigns/campaign-run.service";
import { CampaignsService } from "./campaigns/campaigns.service";

function engineDeps(db: Kysely<DB>): EngineDeps {
  // duplicate/abCompare only touch this.db; the rest of EngineDeps is unused here.
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
    email: `econ-ab-${suffix}@10xconnect.test`,
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
      .values({ name: `Econ AB ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.insertInto("memberships").values({ workspace_id: ws.id, user_id: userId, role: "owner" }).execute();
    await body({ db, workspaceId: ws.id });
  } finally {
    await admin.auth.admin.deleteUser(userId);
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
      name: "Sender",
      provider_account_id: `prov-${randomUUID()}`,
      proxy_type: "bundled",
      country: "US",
      location: "US",
      status: "active",
      health_score: 100,
      warmup_state: JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" }),
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
      enrichment: JSON.stringify({ firstName: "Jordan" }),
      tags: [],
      connection_degree: 1,
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function enroll(
  db: Kysely<DB>,
  workspaceId: string,
  campaignId: string,
  leadId: string,
  status: string,
): Promise<void> {
  await db
    .insertInto("lead_campaign_state")
    .values({ workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, status, history: JSON.stringify([]) })
    .execute();
}

type PipelineStage = "new" | "in_conversation" | "qualified" | "booked" | "lost";

async function seedConversation(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string,
  leadId: string,
  stage: PipelineStage,
): Promise<string> {
  const row = await db
    .insertInto("conversations")
    .values({ workspace_id: workspaceId, account_id: accountId, lead_id: leadId, channel: "linkedin", pipeline_stage: stage })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

test("unit economics (overall + per-campaign), duplicate, and A/B compare run from real backends", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const accountId = await seedAccount(db, workspaceId);

    // --- Seed two avatars (A/B): same persona, different audience ------------
    const campaignA = (
      await db
        .insertInto("campaigns")
        .values({
          workspace_id: workspaceId,
          name: "Avatar A",
          status: "draft",
          account_id: accountId,
          objective: JSON.stringify({ goal: "book a demo" }),
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
    const campaignB = (
      await db
        .insertInto("campaigns")
        .values({ workspace_id: workspaceId, name: "Avatar B", status: "draft", account_id: accountId })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;

    // Campaign A gets a 2-node graph (so duplicate has structure to clone).
    const aWait = (
      await db
        .insertInto("sequence_nodes")
        .values({
          workspace_id: workspaceId,
          campaign_id: campaignA,
          kind: "action",
          type: "wait_x_days",
          config: JSON.stringify({ days: 2 }),
          delay_days: 2,
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaignA,
        kind: "action",
        type: "send_message",
        config: JSON.stringify({ body: "Hi {first_name}" }),
        next_node_id: aWait,
      })
      .execute();

    // AI spend per campaign (budget_ledger is keyed by campaign_id).
    await db
      .insertInto("budget_ledger")
      .values({ campaign_id: campaignA, window: "2026-06-01", workspace_id: workspaceId, tokens_used: 1000, usd_used: 4 })
      .execute();
    await db
      .insertInto("budget_ledger")
      .values({ campaign_id: campaignB, window: "2026-06-01", workspace_id: workspaceId, tokens_used: 500, usd_used: 3 })
      .execute();

    // Outcomes. A: 2 leads → 1 booked + 1 qualified conversation; B: 1 booked.
    const a1 = await seedLead(db, workspaceId);
    const a2 = await seedLead(db, workspaceId);
    const b1 = await seedLead(db, workspaceId);
    await enroll(db, workspaceId, campaignA, a1, "replied");
    await enroll(db, workspaceId, campaignA, a2, "active");
    await enroll(db, workspaceId, campaignB, b1, "active");
    const convA1 = await seedConversation(db, workspaceId, accountId, a1, "booked");
    await seedConversation(db, workspaceId, accountId, a2, "qualified");
    await seedConversation(db, workspaceId, accountId, b1, "booked");
    // One inbound message on A's booked conversation → replies = 1 for campaign A.
    await db
      .insertInto("messages")
      .values({ workspace_id: workspaceId, conversation_id: convA1, direction: "inbound", channel: "linkedin", body: "Interested!" })
      .execute();

    const analytics = new AnalyticsService(db);
    const campaigns = new CampaignsService(db);
    const runService = new CampaignRunService(db, engineDeps(db), campaigns);

    // --- 1. UNIT ECONOMICS: overall vs per-campaign -------------------------
    const overall = await analytics.unitEconomics(workspaceId, "all");
    assert.equal(overall.totalSpendUsd, 7, "overall spend = A($4) + B($3)");
    assert.equal(overall.conversations, 3, "overall conversations = 3");
    assert.equal(overall.bookedMeetings, 2, "overall booked = 2");
    assert.equal(overall.qualified, 1, "overall qualified = 1");
    assert.equal(overall.costPerConversationUsd, 2.3333, "overall $/conversation = 7/3");
    assert.equal(overall.costPerBookedMeetingUsd, 3.5, "overall $/booked = 7/2");

    const a = await analytics.campaignUnitEconomics(workspaceId, campaignA, "all");
    assert.equal(a.totalSpendUsd, 4, "A spend = $4");
    assert.equal(a.conversations, 2, "A conversations = 2 (via lead_campaign_state)");
    assert.equal(a.bookedMeetings, 1, "A booked = 1");
    assert.equal(a.qualified, 1, "A qualified = 1");
    assert.equal(a.replies, 1, "A replies = 1 inbound message");
    assert.equal(a.costPerConversationUsd, 2, "A $/conversation = 4/2");
    assert.equal(a.costPerBookedMeetingUsd, 4, "A $/booked = 4/1");

    const b = await analytics.campaignUnitEconomics(workspaceId, campaignB, "all");
    assert.equal(b.totalSpendUsd, 3, "B spend = $3");
    assert.equal(b.conversations, 1, "B conversations = 1");
    assert.equal(b.bookedMeetings, 1, "B booked = 1");
    assert.equal(b.costPerBookedMeetingUsd, 3, "B $/booked = 3/1");

    // Per-campaign scoping is genuine — A is NOT the workspace total.
    assert.notEqual(a.totalSpendUsd, overall.totalSpendUsd, "campaign spend ≠ workspace spend");
    assert.notEqual(a.conversations, overall.conversations, "campaign conversations ≠ workspace conversations");

    // --- 2. A/B COMPARE: both campaigns + folded-in cost --------------------
    const cmp = await runService.abCompare(workspaceId, [campaignA, campaignB]);
    assert.equal(cmp.length, 2, "both campaigns returned");
    assert.equal(cmp[0].campaignId, campaignA, "order preserved (A first)");
    const oa = cmp.find((c) => c.campaignId === campaignA);
    const ob = cmp.find((c) => c.campaignId === campaignB);
    assert.ok(oa && ob, "both outcomes present");
    assert.equal(oa.name, "Avatar A", "A name rendered");
    assert.equal(ob.name, "Avatar B", "B name rendered");
    assert.equal(oa.enrolled, 2, "A enrolled = 2");
    assert.equal(ob.enrolled, 1, "B enrolled = 1");
    assert.equal(oa.replied, 1, "A replied = 1 (lead_campaign_state)");
    // Unit economics folded into the A/B readout:
    assert.equal(oa.spendUsd, 4, "A spend folded in");
    assert.equal(oa.conversations, 2, "A conversations folded in");
    assert.equal(oa.bookedMeetings, 1, "A booked folded in");
    assert.equal(oa.costPerConversationUsd, 2, "A $/conversation folded in");
    assert.equal(oa.costPerBookedMeetingUsd, 4, "A $/booked folded in");
    assert.equal(ob.spendUsd, 3, "B spend folded in");
    assert.equal(ob.costPerBookedMeetingUsd, 3, "B $/booked folded in — B books cheaper");

    // --- 3. DUPLICATE: fresh draft, 0 contacts, keeps account binding -------
    const dup = await runService.duplicate(workspaceId, campaignA, "Avatar A — variant");
    assert.ok(dup.campaignId && dup.campaignId !== campaignA, "a NEW campaign was created");
    assert.equal(dup.nodeCount, 2, "structure cloned (2 nodes)");
    const clone = await db
      .selectFrom("campaigns")
      .select(["status", "account_id", "name"])
      .where("id", "=", dup.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(clone.status, "draft", "fresh DRAFT");
    assert.equal(clone.name, "Avatar A — variant", "named as requested");
    assert.equal(clone.account_id, accountId, "duplicate KEEPS the account binding (unlike a template)");
    const cloneNodes = await db
      .selectFrom("sequence_nodes")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("campaign_id", "=", dup.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(cloneNodes.c), 2, "clone graph persisted");
    const cloneContacts = await db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("campaign_id", "=", dup.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(cloneContacts.c), 0, "fresh clone has 0 contacts — ready for a swapped list");
  });
});
