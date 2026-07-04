// Test gate — integrations outbox emission (Phase B). DB-backed, throwaway
// workspace. Proves the engine seams write integration_events rows exactly
// once:
//   1. REPLY   — an inbound reply emits one `reply` event; replaying the same
//      provider event id emits nothing new (dedupe at BOTH lead_events and the
//      outbox layers).
//   2. ACCEPT  — an invite_accepted inbound event emits `accepted_invite`.
//   3. STATUS  — flagAccountIncident emits `status_change`, once per
//      account/incident/day even when flagged repeatedly.
//   4. SAFE    — emitIntegrationEvent NEVER throws (bad FK swallowed) — a
//      broken outbox must not break dispatch.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type { InboundEvent } from "@10xconnect/core";

import { emitIntegrationEvent } from "./events";
import { processInboundEvent } from "./inbound";
import { flagAccountIncident } from "./restrictions";
import { seedWorkspace } from "./testing/seed-workspace";

const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });

test("outbox: reply + accepted_invite + status_change emit exactly once; emit never throws", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const account = await db
      .insertInto("sending_accounts")
      .values({
        workspace_id: workspaceId,
        type: "linkedin",
        connection_method: "extension",
        name: "Outbox Test",
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
    const linkedinUrl = `https://linkedin.com/in/outbox-${randomUUID()}`;
    const lead = await db
      .insertInto("leads")
      .values({
        workspace_id: workspaceId,
        linkedin_url: linkedinUrl,
        enrichment: JSON.stringify({ firstName: "Jordan", lastName: "Reyes" }),
        tags: [],
        connection_degree: 2,
        enrich_status: "enriched",
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const events = () =>
      db
        .selectFrom("integration_events")
        .select(["type", "dedupe_key", "payload"])
        .where("workspace_id", "=", workspaceId)
        .execute();

    // --- 1. REPLY (once, with dedupe on replay) ------------------------------
    const replyEventId = `evt-reply-${randomUUID()}`;
    const reply: InboundEvent = {
      id: replyEventId,
      accountId: account.id,
      channel: "linkedin",
      occurredAt: new Date().toISOString(),
      type: "reply",
      lead: { linkedinUrl },
      message: { body: "Interesting — tell me more?" },
    } as InboundEvent;
    await processInboundEvent({ db }, reply);
    await processInboundEvent({ db }, reply); // replay → duplicate, no re-emit
    let rows = await events();
    const replies = rows.filter((r) => r.type === "reply");
    assert.equal(replies.length, 1, "exactly one reply event emitted");
    assert.equal(replies[0].dedupe_key, `reply:${replyEventId}`);
    const payload = replies[0].payload as {
      lead?: { name?: string };
      message?: { body?: string };
    };
    assert.equal(payload.lead?.name, "Jordan Reyes", "lead name in payload");
    assert.equal(payload.message?.body, "Interesting — tell me more?", "message body in payload");

    // --- 2. ACCEPTED INVITE ---------------------------------------------------
    const acceptId = `evt-accept-${randomUUID()}`;
    await processInboundEvent({ db }, {
      id: acceptId,
      accountId: account.id,
      channel: "linkedin",
      occurredAt: new Date().toISOString(),
      type: "invite_accepted",
      lead: { linkedinUrl },
    } as InboundEvent);
    rows = await events();
    const accepts = rows.filter((r) => r.type === "accepted_invite");
    assert.equal(accepts.length, 1, "accepted_invite emitted");
    assert.equal(accepts[0].dedupe_key, `accepted_invite:${acceptId}`);

    // --- 3. STATUS CHANGE (deduped per account/incident/day) -------------------
    await flagAccountIncident(db, workspaceId, account.id, "restricted");
    await flagAccountIncident(db, workspaceId, account.id, "restricted");
    rows = await events();
    const statuses = rows.filter((r) => r.type === "status_change");
    assert.equal(statuses.length, 1, "status_change emitted once per day");

    // --- 4. EMIT NEVER THROWS (bad workspace FK) -------------------------------
    await emitIntegrationEvent(db, {
      workspaceId: randomUUID(), // violates the workspaces FK
      type: "reply",
      dedupeKey: `never-throws-${randomUUID()}`,
      payload: {},
    });
    assert.ok(true, "emitIntegrationEvent swallowed the FK violation");

    // lead present in the emitted reply → sanity that leadEventSummary resolved it
    assert.ok(lead.id, "seeded lead exists");
  } finally {
    await w.cleanup();
  }
});
