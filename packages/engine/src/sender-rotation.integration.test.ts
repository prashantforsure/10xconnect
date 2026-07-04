// Multi-account sender rotation (agency parity — HeyReach/Aimfox). Proves the four
// guarantees of the sender pool (packages/engine/src/senders.ts):
//   1. balanceAssign spreads leads least-loaded across the pool (pure).
//   2. getCampaignPool / assignablePool resolve the pool + health-filter it (DB).
//   3. startCampaign assigns each lead a STICKY sender ~evenly and stamps it on the
//      scheduled action (DB) — a lead keeps one sender for its whole sequence.
//   4. countActionsToday isolates the daily budget PER account (DB) — 3 senders each
//      get their own cap, so ban risk stays isolated (§6).
//   5. dispatch reroutes a lead off a paused sender to a healthy pool member (DB).
//
// Dispatch assertions use an OLD fixed clock + old scheduled_at so this file only
// claims its OWN due action (dispatchDueActions claims DB-wide — see the engine
// global-claim note), and the reroute outcome is workspace-deterministic regardless
// of which parallel test's loop happens to claim it.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { type ActionResult, type ChannelAdapter, defaultDailyCaps } from "@10xconnect/core";

import { startCampaign } from "./campaign-runner";
import { dispatchDueActions } from "./dispatch";
import { countActionsToday } from "./repository";
import { assignablePool, balanceAssign, getCampaignPool, pickRerouteSender } from "./senders";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const WARMED = JSON.stringify({ phase: "active", startedAt: "2015-01-01T00:00:00.000Z" });

/** Runner clock in the FAR future so freshly-scheduled actions are never claimed by a
 * parallel dispatch mid-test (this file's assignment tests don't dispatch at all). */
const FUTURE = new Date("2030-01-01T12:00:00.000Z");

function runnerDeps(db: EngineDeps["db"], adapter?: ChannelAdapter, now: Date = FUTURE): EngineDeps {
  return {
    db,
    adapter: adapter ?? ({} as ChannelAdapter), // unused unless we dispatch
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => now,
    modelLabel: "mock",
  };
}

type AccountStatus = "active" | "warming" | "paused" | "restricted" | "disconnected";

async function seedAccount(
  db: EngineDeps["db"],
  workspaceId: string,
  status: AccountStatus = "active",
  label = "Sender",
): Promise<string> {
  const row = await db
    .insertInto("sending_accounts")
    .values({
      workspace_id: workspaceId,
      type: "linkedin",
      connection_method: "extension",
      name: label,
      label,
      provider_account_id: `prov-${randomUUID()}`,
      proxy_type: "bundled",
      country: "US",
      location: "US",
      status,
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
      connection_degree: 2,
      enrich_status: "enriched",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Attach a pool of accounts to a campaign via campaign_accounts (order = insert order). */
async function setPool(
  db: EngineDeps["db"],
  workspaceId: string,
  campaignId: string,
  accountIds: string[],
): Promise<void> {
  for (const accountId of accountIds) {
    await db
      .insertInto("campaign_accounts")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, account_id: accountId })
      .execute();
  }
}

// --- 1. Pure least-loaded distribution -------------------------------------

test("balanceAssign spreads leads least-loaded across the pool, ties break on pool order", () => {
  // Empty load, even count → perfect round-robin in pool order.
  assert.deepEqual(balanceAssign(6, ["A", "B"], new Map()), ["A", "B", "A", "B", "A", "B"]);
  // Three-account pool, empty load.
  assert.deepEqual(balanceAssign(3, ["A", "B", "C"], new Map()), ["A", "B", "C"]);
  // Seeded uneven load: A already carries 2 → the next go to B until it catches up.
  const out = balanceAssign(4, ["A", "B"], new Map([["A", 2], ["B", 0]]));
  assert.deepEqual(out, ["B", "B", "A", "B"]); // final load A=3, B=3 — balanced
  // Empty pool → nothing assigned (caller then leaves account_id null).
  assert.deepEqual(balanceAssign(5, [], new Map()), []);
});

// --- 2. Pool resolution + health filter ------------------------------------

test("getCampaignPool returns campaign_accounts order, else falls back to the single account_id", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const a = await seedAccount(db, workspaceId, "active", "A");
    const b = await seedAccount(db, workspaceId, "active", "B");

    const campaign = await db
      .insertInto("campaigns")
      .values({ workspace_id: workspaceId, name: "Pool", status: "draft", account_id: a })
      .returning("id")
      .executeTakeFirstOrThrow();

    // No pool rows yet → fall back to the campaign's single bound account.
    assert.deepEqual(await getCampaignPool(db, campaign.id, a), [a]);
    // No pool + no bound account → empty (campaign is unstartable).
    assert.deepEqual(await getCampaignPool(db, campaign.id, null), []);

    // With a pool, order follows created_at (insert order): [a, b].
    await setPool(db, workspaceId, campaign.id, [a, b]);
    assert.deepEqual(await getCampaignPool(db, campaign.id, a), [a, b]);
  } finally {
    await w.cleanup();
  }
});

test("assignablePool prefers healthy senders, but falls back to the full pool when all are down", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const active = await seedAccount(db, workspaceId, "active", "active");
    const warming = await seedAccount(db, workspaceId, "warming", "warming");
    const paused = await seedAccount(db, workspaceId, "paused", "paused");
    const restricted = await seedAccount(db, workspaceId, "restricted", "restricted");

    // active + warming can take a new lead; paused/restricted are filtered out.
    const healthy = await assignablePool(db, [active, warming, paused, restricted]);
    assert.deepEqual(healthy.sort(), [active, warming].sort());

    // If EVERY pool member is down, fall back to the raw pool (campaign still enrolls;
    // its actions just hold until an account recovers) — preserves single-account behavior.
    const allDown = await assignablePool(db, [paused, restricted]);
    assert.deepEqual(allDown.sort(), [paused, restricted].sort());
  } finally {
    await w.cleanup();
  }
});

// --- 3. Sticky assignment at start -----------------------------------------

test("startCampaign assigns a sticky sender to each lead ~evenly and stamps it on the action", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const a = await seedAccount(db, workspaceId, "active", "A");
    const b = await seedAccount(db, workspaceId, "active", "B");

    const campaign = await db
      .insertInto("campaigns")
      .values({
        workspace_id: workspaceId,
        name: "Rotation",
        status: "draft",
        account_id: a,
        caps: JSON.stringify(defaultDailyCaps()),
        autonomy: JSON.stringify({ mode: "approve_all" }), // no grounding gate on start
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        kind: "action",
        type: "send_connection_request",
        config: JSON.stringify({}),
      })
      .execute();
    await setPool(db, workspaceId, campaign.id, [a, b]);

    // Six leads enrolled (positioned on the root node) before start.
    for (let i = 0; i < 6; i += 1) {
      const leadId = await seedLead(db, workspaceId);
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

    const started = await startCampaign(runnerDeps(db), workspaceId, campaign.id);
    assert.equal(started.scheduled, 6, "all six leads scheduled");

    // Each lead got a sticky sender; with an empty starting load the split is 3/3.
    const states = await db
      .selectFrom("lead_campaign_state")
      .select(["lead_id", "account_id"])
      .where("campaign_id", "=", campaign.id)
      .execute();
    const countA = states.filter((s) => s.account_id === a).length;
    const countB = states.filter((s) => s.account_id === b).length;
    assert.equal(countA, 3, "three leads assigned to sender A");
    assert.equal(countB, 3, "three leads assigned to sender B");
    assert.equal(states.every((s) => s.account_id === a || s.account_id === b), true, "no lead left unassigned");

    // The scheduled action for each lead carries that lead's sticky sender (not just
    // the campaign default) — so the rate governor + proxy isolate per sender.
    const byLeadState = new Map(states.map((s) => [s.lead_id, s.account_id]));
    const actions = await db
      .selectFrom("actions")
      .select(["lead_id", "account_id"])
      .where("campaign_id", "=", campaign.id)
      .execute();
    assert.equal(actions.length, 6, "one action per lead");
    for (const action of actions) {
      assert.equal(
        action.account_id,
        byLeadState.get(action.lead_id ?? ""),
        "action sender matches the lead's sticky sender",
      );
    }
  } finally {
    await w.cleanup();
  }
});

// --- 4. Per-account budget isolation ---------------------------------------

test("countActionsToday isolates the daily budget per account (3 senders → 3 separate caps)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const a = await seedAccount(db, workspaceId, "active", "A");
    const b = await seedAccount(db, workspaceId, "active", "B");
    const now = new Date("2019-05-01T12:00:00.000Z");
    const earlierToday = "2019-05-01T09:00:00.000Z";
    const lead = await seedLead(db, workspaceId);

    // Record connection-request sends today: A twice, B once — different accounts.
    const record = async (accountId: string) =>
      db
        .insertInto("actions")
        .values({
          workspace_id: workspaceId,
          account_id: accountId,
          lead_id: lead,
          type: "connection_request",
          status: "success",
          idempotency_key: `rot:${randomUUID()}`,
          scheduled_at: earlierToday,
          executed_at: earlierToday,
          result: JSON.stringify({ providerRef: "SIMULATED" }),
        })
        .execute();
    await record(a);
    await record(a);
    await record(b);

    // Each account's counter sees ONLY its own sends — the whole point of per-account
    // caps: A being at its limit never blocks B (ban risk isolated per sender).
    assert.equal(await countActionsToday(db, a, "connection_request", now), 2, "A counts its own two");
    assert.equal(await countActionsToday(db, b, "connection_request", now), 1, "B counts its own one");
    // A different action type on the same account is a separate budget.
    assert.equal(await countActionsToday(db, a, "message", now), 0, "message budget independent of conn-req");
  } finally {
    await w.cleanup();
  }
});

// --- 5. Reroute picking + live dispatch reroute ----------------------------

test("pickRerouteSender returns a healthy alternate excluding the current, else null", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const a = await seedAccount(db, workspaceId, "paused", "A"); // the failed sender
    const b = await seedAccount(db, workspaceId, "active", "B"); // healthy alternate

    const campaign = await db
      .insertInto("campaigns")
      .values({ workspace_id: workspaceId, name: "Reroute", status: "running", account_id: a })
      .returning("id")
      .executeTakeFirstOrThrow();
    await setPool(db, workspaceId, campaign.id, [a, b]);

    // Away from paused A → healthy B.
    assert.equal(await pickRerouteSender(db, { id: campaign.id, account_id: a }, a), b);

    // If B also goes down, no healthy alternate remains → null (caller holds).
    await db.updateTable("sending_accounts").set({ status: "restricted" }).where("id", "=", b).execute();
    assert.equal(await pickRerouteSender(db, { id: campaign.id, account_id: a }, a), null);
  } finally {
    await w.cleanup();
  }
});

test("dispatch reroutes a lead off a paused sender to a healthy pool member (SIMULATED)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    // Simulation ON so the reroute never touches a real transport.
    await db
      .updateTable("workspaces")
      .set({ settings: JSON.stringify({ simulation_mode: true }) })
      .where("id", "=", workspaceId)
      .execute();

    const paused = await seedAccount(db, workspaceId, "paused", "A"); // lead's assigned (now dead) sender
    const healthy = await seedAccount(db, workspaceId, "active", "B"); // the reroute target

    const campaign = await db
      .insertInto("campaigns")
      .values({
        workspace_id: workspaceId,
        name: "Reroute dispatch",
        status: "running",
        account_id: paused,
        caps: JSON.stringify(defaultDailyCaps()),
        autonomy: JSON.stringify({ mode: "approve_all" }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await setPool(db, workspaceId, campaign.id, [paused, healthy]);

    const node = await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        kind: "action",
        type: "send_message",
        config: JSON.stringify({ body: "Hi {first_name}" }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const lead = await seedLead(db, workspaceId);
    await db
      .insertInto("lead_campaign_state")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        lead_id: lead,
        current_node_id: node.id,
        status: "active",
        account_id: paused, // sticky-assigned to the sender that has since gone down
        history: JSON.stringify([]),
      })
      .execute();

    const now = new Date("2017-03-02T12:00:00.000Z");
    const old = "2017-03-01T00:00:00.000Z"; // due + old enough to isolate this file's claim
    const idem = `rot:${randomUUID()}`;
    await db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: paused,
        lead_id: lead,
        campaign_id: campaign.id,
        node_id: node.id,
        type: "message",
        status: "pending",
        idempotency_key: idem,
        scheduled_at: old,
        config: JSON.stringify({ body: "Hi {first_name}" }),
      })
      .execute();

    // A recording adapter proves the transport was NEVER called (simulation short-circuits).
    const sent: string[] = [];
    const adapter = {
      sendMessage: async (_a: unknown, _l: unknown, _c: unknown, opts: { idempotencyKey: string }) => {
        sent.push(opts.idempotencyKey);
        return { status: "success", idempotencyKey: opts.idempotencyKey, at: now.toISOString() } as ActionResult;
      },
    } as unknown as ChannelAdapter;

    await dispatchDueActions(runnerDeps(db, adapter, now));

    // The action succeeded, is SIMULATED, and was rerouted onto the HEALTHY sender.
    const action = await db
      .selectFrom("actions")
      .select(["status", "account_id", "result"])
      .where("idempotency_key", "=", idem)
      .executeTakeFirstOrThrow();
    assert.equal(action.status, "success", "the rerouted send succeeded");
    assert.equal(action.account_id, healthy, "action now attributed to the healthy sender");
    const result = typeof action.result === "string" ? JSON.parse(action.result) : action.result;
    assert.equal((result as { providerRef?: string })?.providerRef, "SIMULATED", "no real send");
    assert.equal(sent.includes(idem), false, "transport never called in simulation");

    // The lead's sticky sender was persisted to the healthy one, so the REST of its
    // sequence follows the new sender (§6 reroute).
    const state = await db
      .selectFrom("lead_campaign_state")
      .select("account_id")
      .where("campaign_id", "=", campaign.id)
      .where("lead_id", "=", lead)
      .executeTakeFirstOrThrow();
    assert.equal(state.account_id, healthy, "lead re-stuck to the healthy sender for the rest of the sequence");
  } finally {
    await w.cleanup();
  }
});
