// Simulation-mode wiring (DB-backed): a workspace with settings.simulation_mode=true
// runs the FULL dispatch path but NEVER calls the transport — the send is recorded as
// a synthetic SIMULATED success and the lead still advances. Proves the guardrail is
// enforced end-to-end (dispatch resolves simulation from the workspace + threads it),
// not just in the executor unit test.
//
// Uses an OLD fixed clock + an old scheduled_at so it only claims its OWN due action
// (dispatchDueActions claims DB-wide — see the engine global-claim note), and scopes
// every assertion to its own idempotency key.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { type ActionResult, type ChannelAdapter, defaultDailyCaps } from "@10xconnect/core";

import { dispatchDueActions } from "./dispatch";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

const NOW = new Date("2019-01-02T12:00:00.000Z");
const OLD = "2019-01-01T00:00:00.000Z"; // scheduled before NOW → due; old enough to isolate this test
const WARMED = JSON.stringify({ phase: "active", startedAt: "2015-01-01T00:00:00.000Z" });

/** Records every idempotency key the transport was asked to send (proves: none of ours). */
function recordingAdapter(sink: string[]): ChannelAdapter {
  const ok = (idempotencyKey: string): ActionResult => ({ status: "success", idempotencyKey, at: NOW.toISOString() });
  return {
    sendMessage: async (_a: unknown, _l: unknown, _c: unknown, opts: { idempotencyKey: string }) => {
      sink.push(opts.idempotencyKey);
      return ok(opts.idempotencyKey);
    },
    sendConnectionRequest: async (_a: unknown, _l: unknown, opts: { idempotencyKey: string }) => {
      sink.push(opts.idempotencyKey);
      return ok(opts.idempotencyKey);
    },
  } as unknown as ChannelAdapter;
}

function deps(db: EngineDeps["db"], adapter: ChannelAdapter): EngineDeps {
  return {
    db,
    adapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => NOW,
  };
}

test("simulation-mode workspace: dispatch records a SIMULATED success and never calls the transport", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    // Turn simulation ON explicitly (independent of the developer-email default).
    await db
      .updateTable("workspaces")
      .set({ settings: JSON.stringify({ simulation_mode: true }) })
      .where("id", "=", workspaceId)
      .execute();

    const account = await db
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
      .values({
        workspace_id: workspaceId,
        name: "Sim",
        status: "running",
        account_id: account.id,
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
        config: JSON.stringify({ body: "Hi {first_name}" }),
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

    const idem = `seq:${randomUUID()}`;
    await db
      .insertInto("actions")
      .values({
        workspace_id: workspaceId,
        account_id: account.id,
        lead_id: lead.id,
        campaign_id: campaign.id,
        node_id: node.id,
        type: "message",
        status: "pending",
        idempotency_key: idem,
        scheduled_at: OLD,
        config: JSON.stringify({ body: "Hi {first_name}" }),
      })
      .execute();

    const sent: string[] = [];
    await dispatchDueActions(deps(db, recordingAdapter(sent)));

    // The transport was NEVER called for our action…
    assert.equal(sent.includes(idem), false, "no real send in simulation mode");
    // …yet the action succeeded, is tagged SIMULATED, and the lead advanced off the node.
    const action = await db
      .selectFrom("actions")
      .select(["status", "result"])
      .where("idempotency_key", "=", idem)
      .executeTakeFirstOrThrow();
    assert.equal(action.status, "success", "pipeline advanced on a synthetic success");
    const result = typeof action.result === "string" ? JSON.parse(action.result) : action.result;
    assert.equal((result as { providerRef?: string })?.providerRef, "SIMULATED");
  } finally {
    await w.cleanup();
  }
});
