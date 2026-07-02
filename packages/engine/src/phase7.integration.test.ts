// Phase 7 Test Gate (DB-backed) — polish/expansion mini-gates. Each sub-item is an
// independent test against the dev Postgres (DATABASE_URL + SUPABASE_*), seeding a
// throwaway workspace and tearing it down. No real LinkedIn messages are sent — all
// dispatch goes through a recording MOCK adapter.
//
//   7.2  campaign duplicate + list-swap A/B avatar testing
//   7.3  Sales Navigator search-URL bulk import + enrichment + dedupe (fixture)
//   7.4  account health from real metrics + acceptance-rate auto-throttle
//   7.5  unit-economics dashboard (cost-per-conversation / cost-per-booked-meeting)
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ActionResult,
  type ChannelAdapter,
  isSalesNavigatorSearchUrl,
  parseSalesNavigatorSearchUrl,
  readThrottleFactor,
  type SourcedLead,
} from "@10xconnect/core";

import { computeAccountHealth } from "./account-health";
import { campaignAbComparison, duplicateCampaign } from "./campaign-duplicate";
import { enrollLeads, startCampaign } from "./campaign-runner";
import { dispatchDueActions } from "./dispatch";
import { importSourcedLeads } from "./lead-import";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";
import { computeUnitEconomics } from "./unit-economics";

type Db = EngineDeps["db"];

const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });

/** A recording mock adapter: every send succeeds and is logged (never real). */
function recordingAdapter(sink: { type: string; idempotencyKey: string }[]): ChannelAdapter {
  const ok = (idempotencyKey: string): ActionResult => ({
    status: "success",
    idempotencyKey,
    providerRef: `ref-${idempotencyKey}`,
    at: new Date("2026-06-30T12:00:00.000Z").toISOString(),
  });
  const rec =
    (type: string) =>
    async (...args: unknown[]) => {
      const opts = args[args.length - 1] as { idempotencyKey: string };
      sink.push({ type, idempotencyKey: opts.idempotencyKey });
      return ok(opts.idempotencyKey);
    };
  return {
    sendConnectionRequest: rec("connection_request"),
    sendMessage: rec("message"),
    sendVoiceNote: rec("voice_note"),
    visitProfile: rec("visit_profile"),
    likePost: rec("like_post"),
    commentPost: rec("comment_post"),
    followLead: rec("follow_lead"),
  } as unknown as ChannelAdapter;
}

/** Mutable-clock deps so we can fast-forward past the dispatch spacing window. */
function makeDeps(db: Db, adapter: ChannelAdapter, clock: { now: Date }): EngineDeps {
  return {
    db,
    adapter,
    config: { minSpacingMs: 1, jitterMs: 0, ignoreWorkingHours: true, batchSize: 100 },
    now: () => clock.now,
  };
}

async function seedAccount(db: Db, workspaceId: string): Promise<string> {
  const a = await db
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
  return a.id;
}

async function seedLead(db: Db, workspaceId: string, firstName: string): Promise<string> {
  const l = await db
    .insertInto("leads")
    .values({
      workspace_id: workspaceId,
      linkedin_url: `https://linkedin.com/in/${firstName.toLowerCase()}-${randomUUID()}`,
      enrichment: JSON.stringify({ firstName }),
      tags: [],
      connection_degree: 2,
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return l.id;
}

async function seedList(db: Db, workspaceId: string, name: string, leadIds: string[]): Promise<string> {
  const list = await db
    .insertInto("contact_lists")
    .values({ workspace_id: workspaceId, name })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const leadId of leadIds) {
    await db.insertInto("list_leads").values({ workspace_id: workspaceId, list_id: list.id, lead_id: leadId }).execute();
  }
  return list.id;
}

async function leadsInList(db: Db, workspaceId: string, listId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("list_leads")
    .select("lead_id")
    .where("workspace_id", "=", workspaceId)
    .where("list_id", "=", listId)
    .execute();
  return rows.map((r) => r.lead_id);
}

async function dispatchUntilIdle(deps: EngineDeps): Promise<number> {
  let total = 0;
  for (let i = 0; i < 6; i += 1) {
    const stats = await dispatchDueActions(deps);
    total += stats.dispatched;
    if (stats.dispatched === 0 && stats.claimed === 0) break;
  }
  return total;
}

test("7.2 duplicate clones structure + list swap → both run on mock, results comparable", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const clock = { now: new Date("2026-06-28T12:00:00.000Z") };
    const sink: { type: string; idempotencyKey: string }[] = [];
    const deps = makeDeps(db, recordingAdapter(sink), clock);

    // Two avatars (different audiences), each its own list.
    const avatarA = [await seedLead(db, workspaceId, "Ana"), await seedLead(db, workspaceId, "Aldo")];
    const avatarB = [await seedLead(db, workspaceId, "Bea"), await seedLead(db, workspaceId, "Ben")];
    const listA = await seedList(db, workspaceId, "Avatar A", avatarA);
    const listB = await seedList(db, workspaceId, "Avatar B", avatarB);

    // Source campaign: a 1-step connection-request sequence, bound to the account.
    // approve_all: this test exercises outbound A/B dispatch, not AI replies —
    // the DB default is Balanced (ai_sdr_activation migration), which would trip
    // the grounding gate (no KB) at start.
    const original = await db
      .insertInto("campaigns")
      .values({
        workspace_id: workspaceId,
        name: "Avatar A/B",
        status: "draft",
        account_id: accountId,
        autonomy: JSON.stringify({ mode: "approve_all" }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: original.id,
        kind: "action",
        type: "send_connection_request",
        config: JSON.stringify({}),
      })
      .execute();

    // DUPLICATE: clones the structure into a fresh draft with 0 contacts.
    const dup = await duplicateCampaign(db, { workspaceId, campaignId: original.id, name: "Avatar B variant" });
    assert.ok(dup);
    assert.equal(dup!.nodeCount, 1, "graph structure cloned");

    const dupLeadsAtClone = await db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("campaign_id", "=", dup!.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(dupLeadsAtClone.c), 0, "duplicate starts with 0 contacts");

    // Structure matches; node ids are fresh (a real clone, not a shared reference).
    const origNodes = await db.selectFrom("sequence_nodes").select(["id", "type"]).where("campaign_id", "=", original.id).execute();
    const dupNodes = await db.selectFrom("sequence_nodes").select(["id", "type"]).where("campaign_id", "=", dup!.campaignId).execute();
    assert.deepEqual(dupNodes.map((n) => n.type), origNodes.map((n) => n.type), "same node types");
    assert.equal(dupNodes.some((n) => origNodes.find((o) => o.id === n.id)), false, "fresh node ids");

    // SWAP THE LIST: original ← Avatar A, duplicate ← Avatar B.
    await enrollLeads(deps, workspaceId, original.id, await leadsInList(db, workspaceId, listA));
    await enrollLeads(deps, workspaceId, dup!.campaignId, await leadsInList(db, workspaceId, listB));

    // Run BOTH on the mock.
    await startCampaign(deps, workspaceId, original.id);
    await startCampaign(deps, workspaceId, dup!.campaignId);
    clock.now = new Date("2026-06-30T12:00:00.000Z"); // fast-forward past spacing
    const dispatched = await dispatchUntilIdle(deps);
    assert.equal(dispatched, 4, "all 4 leads across both campaigns sent via mock (2 + 2)");
    assert.equal(sink.every((s) => s.type === "connection_request"), true, "only mock connection requests — no real sends");

    // RESULTS COMPARABLE: side-by-side outcomes for the A/B set.
    const cmp = await campaignAbComparison(db, { workspaceId, campaignIds: [original.id, dup!.campaignId] });
    assert.equal(cmp.length, 2);
    const a = cmp.find((c) => c.campaignId === original.id)!;
    const b = cmp.find((c) => c.campaignId === dup!.campaignId)!;
    assert.equal(a.enrolled, 2);
    assert.equal(b.enrolled, 2);
    assert.equal(a.sent, 2, "avatar A sent");
    assert.equal(b.sent, 2, "avatar B sent");
    // No cross-contamination: each campaign enrolled only its own avatar's leads.
    const aLeads = await db.selectFrom("lead_campaign_state").select("lead_id").where("campaign_id", "=", original.id).execute();
    assert.equal(aLeads.every((r) => avatarA.includes(r.lead_id)), true, "campaign A holds only avatar A");
  } finally {
    await w.cleanup();
  }
});

/**
 * Deterministic Sales-Nav fixture: the SAME search URL always yields the SAME
 * leads (so re-import dedupes to zero). Every 5th is email-only (exercises the
 * email dedupe path). No network — a fixture, not a real search.
 */
function salesNavFixture(url: string, n: number): SourcedLead[] {
  const slug = parseSalesNavigatorSearchUrl(url)?.keywords?.replace(/\s+/g, "-").toLowerCase() ?? "search";
  const leads: SourcedLead[] = [];
  for (let i = 0; i < n; i += 1) {
    const lead: SourcedLead = {
      firstName: `First${i}`,
      lastName: `Last${i}`,
      headline: `Head of Growth at Co${i}`,
      company: `Co${i}`,
      role: "Head of Growth",
      location: "Remote",
      connectionDegree: (i % 2) + 2,
      providerId: `snav-${slug}-${i}`,
    };
    if (i % 5 === 4) {
      lead.email = `first${i}.last${i}@co${i}.com`; // email-only
    } else {
      lead.linkedinUrl = `https://www.linkedin.com/in/${slug}-first${i}-last${i}`;
    }
    leads.push(lead);
  }
  return leads;
}

test("7.3 Sales Navigator search URL → enriched contacts imported + deduped (fixture)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const searchUrl = "https://www.linkedin.com/sales/search/people?query=(keywords:head%20of%20growth)&sessionId=x";

    // The URL is validated as a real Sales Nav SEARCH url (not a profile/feed link).
    assert.equal(isSalesNavigatorSearchUrl(searchUrl), true);
    assert.equal(isSalesNavigatorSearchUrl("https://www.linkedin.com/in/jane-doe"), false);

    const list = await db
      .insertInto("contact_lists")
      .values({ workspace_id: workspaceId, name: "Sales Navigator" })
      .returning("id")
      .executeTakeFirstOrThrow();

    const fixture = salesNavFixture(searchUrl, 12);

    // First import: all 12 are new, persisted with their sourced enrichment.
    const first = await importSourcedLeads(db, {
      workspaceId,
      leads: fixture,
      source: "sales_navigator",
      listId: list.id,
    });
    assert.equal(first.created, 12, "all 12 imported");
    assert.equal(first.duplicates, 0);

    // Enrichment landed + each new lead is queued for deep enrichment.
    const rows = await db
      .selectFrom("leads")
      .select(["enrichment", "enrich_status", "email", "linkedin_url"])
      .where("workspace_id", "=", workspaceId)
      .execute();
    assert.equal(rows.length, 12);
    assert.equal(rows.every((r) => r.enrich_status === "pending"), true, "queued for enrichment");
    const sample = rows.find((r) => r.linkedin_url)!;
    const enr = sample.enrichment as { firstName?: string; company?: string; source?: string };
    assert.ok(enr.firstName && enr.company, "sourced enrichment persisted");
    assert.equal(enr.source, "sales_navigator");
    assert.ok(rows.some((r) => r.email && !r.linkedin_url), "email-only leads imported too");

    // Linked to the list.
    const inList = await db
      .selectFrom("list_leads")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("list_id", "=", list.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(inList.c), 12);

    // RE-IMPORT the same search → DEDUPED to zero new (workspace dedupe_key).
    const second = await importSourcedLeads(db, {
      workspaceId,
      leads: salesNavFixture(searchUrl, 12),
      source: "sales_navigator",
      listId: list.id,
    });
    assert.equal(second.created, 0, "re-import creates nothing");
    assert.equal(second.duplicates, 12, "all 12 deduped (incl. the email-only lead)");

    const totalAfter = await db
      .selectFrom("leads")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("workspace_id", "=", workspaceId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(totalAfter.c), 12, "still 12 leads — no duplicates persisted");
  } finally {
    await w.cleanup();
  }
});

/** Seed N successful connection requests + M accepted invites for an account. */
async function seedAcceptance(db: Db, workspaceId: string, accountId: string, requests: number, accepted: number): Promise<void> {
  for (let i = 0; i < requests; i += 1) {
    const lead = await seedLead(db, workspaceId, `Acc${i}`);
    await db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: accountId,
        lead_id: lead,
        type: "connection_request",
        status: "success",
        idempotency_key: `cr:${accountId}:${i}:${randomUUID()}`,
        scheduled_at: new Date("2026-06-20T12:00:00.000Z").toISOString(),
        config: JSON.stringify({}),
      })
      .execute();
    if (i < accepted) {
      await db
        .insertInto("lead_events")
        .values({
          workspace_id: workspaceId,
          account_id: accountId,
          lead_id: lead,
          type: "invite_accepted",
          channel: "linkedin",
          occurred_at: new Date("2026-06-21T12:00:00.000Z").toISOString(),
        })
        .execute();
    }
  }
}

test("7.4 account health reflects real activity; acceptance-rate auto-throttle fires below threshold", async () => {
  // LOW acceptance (5%) → throttle fires.
  const low = await seedWorkspace();
  try {
    const { db, workspaceId } = low;
    const accountId = await seedAccount(db, workspaceId);
    await seedAcceptance(db, workspaceId, accountId, 20, 1); // 1/20 = 5%

    const report = await computeAccountHealth(db, { workspaceId, accountId, now: new Date("2026-06-28T12:00:00.000Z") });
    assert.equal(report.input.connectionRequestsSent, 20);
    assert.equal(report.input.invitesAccepted, 1);
    assert.ok(report.acceptanceRate !== null && Math.abs(report.acceptanceRate - 0.05) < 0.001, "acceptance rate from real data");
    assert.ok(report.signals.some((s) => /acceptance rate/i.test(s)), "low-acceptance signal");

    // Health score persisted (reflects the low acceptance).
    const acct = await db.selectFrom("sending_accounts").select(["health_score", "warmup_state"]).where("id", "=", accountId).executeTakeFirstOrThrow();
    assert.equal(acct.health_score, report.score);
    assert.ok(report.score < 100, "score dropped from the low acceptance rate");

    // THROTTLE fired: severe (factor 0.25), persisted on warmup_state, governor will honor it.
    assert.equal(report.throttle.throttled, true);
    assert.equal(report.throttle.factor, 0.25);
    assert.equal(readThrottleFactor(acct.warmup_state), 0.25, "throttle persisted for the rate governor");

    // A one-time owner notification was raised.
    const notif = await db
      .selectFrom("notifications")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "account_throttled")
      .executeTakeFirstOrThrow();
    assert.equal(Number(notif.c), 1, "throttle notification raised once");

    // Recompute → still throttled, but NO duplicate notification (fires on transition only).
    await computeAccountHealth(db, { workspaceId, accountId, now: new Date("2026-06-28T13:00:00.000Z") });
    const notif2 = await db
      .selectFrom("notifications")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("workspace_id", "=", workspaceId)
      .where("type", "=", "account_throttled")
      .executeTakeFirstOrThrow();
    assert.equal(Number(notif2.c), 1, "no duplicate throttle notification on recompute");
  } finally {
    await low.cleanup();
  }

  // HEALTHY acceptance (50%) → no throttle.
  const high = await seedWorkspace();
  try {
    const { db, workspaceId } = high;
    const accountId = await seedAccount(db, workspaceId);
    await seedAcceptance(db, workspaceId, accountId, 20, 10); // 50%

    const report = await computeAccountHealth(db, { workspaceId, accountId, now: new Date("2026-06-28T12:00:00.000Z") });
    assert.ok(report.acceptanceRate !== null && Math.abs(report.acceptanceRate - 0.5) < 0.001);
    assert.equal(report.throttle.throttled, false, "healthy acceptance → no throttle");
    assert.equal(report.throttle.factor, 1);
    assert.equal(report.score, 100, "full health");
    const acct = await db.selectFrom("sending_accounts").select("warmup_state").where("id", "=", accountId).executeTakeFirstOrThrow();
    assert.equal(readThrottleFactor(acct.warmup_state), 1, "no throttle applied to the governor");
  } finally {
    await high.cleanup();
  }
});

type PipelineStage = "new" | "in_conversation" | "qualified" | "booked" | "lost";

async function seedConversation(db: Db, workspaceId: string, accountId: string, stage: PipelineStage, withReply: boolean): Promise<void> {
  const leadId = await seedLead(db, workspaceId, "Conv");
  const convo = await db
    .insertInto("conversations")
    .values({ workspace_id: workspaceId, account_id: accountId, lead_id: leadId, channel: "linkedin", pipeline_stage: stage })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (withReply) {
    await db
      .insertInto("messages")
      .values({ workspace_id: workspaceId, conversation_id: convo.id, direction: "inbound", channel: "linkedin", body: "interested!" })
      .execute();
  }
}

test("7.5 unit-economics: cost-per-conversation + cost-per-booked-meeting compute on seeded data", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);

    // AI spend = $12.00 over the budget ledger (two campaign-days).
    const campaign = await db
      .insertInto("campaigns")
      .values({ workspace_id: workspaceId, name: "Econ", status: "running", account_id: accountId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("budget_ledger")
      .values([
        { workspace_id: workspaceId, campaign_id: campaign.id, window: "2026-06-27", usd_used: "5.00", tokens_used: 12_000 },
        { workspace_id: workspaceId, campaign_id: campaign.id, window: "2026-06-28", usd_used: "7.00", tokens_used: 18_000 },
      ])
      .execute();

    // Outcomes: 6 conversations (3 in-conversation, 2 qualified, 1 booked); 4 replied.
    await seedConversation(db, workspaceId, accountId, "in_conversation", true);
    await seedConversation(db, workspaceId, accountId, "in_conversation", true);
    await seedConversation(db, workspaceId, accountId, "in_conversation", false);
    await seedConversation(db, workspaceId, accountId, "qualified", true);
    await seedConversation(db, workspaceId, accountId, "qualified", false);
    await seedConversation(db, workspaceId, accountId, "booked", true);

    const econ = await computeUnitEconomics(db, { workspaceId });

    assert.equal(econ.totalSpendUsd, 12, "spend summed from budget_ledger");
    assert.equal(econ.totalTokens, 30_000);
    assert.equal(econ.conversations, 6);
    assert.equal(econ.qualified, 2);
    assert.equal(econ.bookedMeetings, 1);
    assert.equal(econ.replies, 4, "inbound messages counted");

    // The headline ratios.
    assert.equal(econ.costPerConversationUsd, 2, "$12 / 6 conversations = $2.00");
    assert.equal(econ.costPerQualifiedUsd, 6, "$12 / 2 qualified = $6.00");
    assert.equal(econ.costPerBookedMeetingUsd, 12, "$12 / 1 booked = $12.00");
  } finally {
    await w.cleanup();
  }
});
