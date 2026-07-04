// Test gate — Slack integration (Phase C). DB-backed + a local sink standing
// in for Slack's incoming-webhook endpoint. Proves:
//   1. FORMAT   — every event type renders a Block Kit message (pure).
//   2. ENCRYPT  — connect stores the webhook URL as SecretCipher ciphertext
//      (≠ plaintext, decrypts back) and posts the welcome message.
//   3. DELIVER  — a subscribed event fans out to a `slack` delivery and the
//      sink receives the formatted message.
//   4. FILTER   — a non-subscribed event creates NO slack delivery.
//   5. TEST     — the test endpoint posts immediately.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { SecretCipher } from "../../common/crypto/secret-cipher";
import { IntegrationsService } from "../integrations.module";

import { DeliveryService } from "./delivery.service";
import { formatSlackMessage } from "./slack-format";
import type { EventEnvelope } from "./webhook-sender";

async function startSink(): Promise<{
  url: string;
  bodies: string[];
  close: () => Promise<void>;
}> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      bodies.push(body);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("sink failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}/services/T000/B000/xyz`,
    bodies,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `slack-${suffix}@10xconnect.test`,
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
      .values({ name: `Slack ${suffix}`, owner_id: userId })
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

test("slack formatter renders every event type", () => {
  const base = { id: "e1", created_at: new Date().toISOString(), workspace_id: "w1" };
  const cases: Array<[string, unknown, string]> = [
    ["reply", { lead: { name: "Ada", linkedin_url: "https://l.i/a" }, message: { body: "hi" } }, "New reply"],
    ["accepted_invite", { lead: { name: "Ada" } }, "accepted your connection"],
    ["hot_lead", { lead: { name: "Ada" }, summary: "Buying now", next_step: "Call" }, "Hot lead"],
    ["status_change", { account: { name: "Main" }, status: "restricted" }, "Account status"],
    ["campaign_completed", { campaign: { name: "Q3" } }, "Campaign completed"],
    ["message_sent", { lead: { name: "Ada" }, action_type: "send_message" }, "sent to"],
    ["some_future_event", {}, "10xConnect event"],
  ];
  for (const [type, data, expect] of cases) {
    const msg = formatSlackMessage({ ...base, type, data } as EventEnvelope);
    assert.ok(msg.text.includes(expect), `${type} → "${msg.text}" includes "${expect}"`);
    assert.ok(Array.isArray(msg.blocks) && msg.blocks.length > 0, `${type} has blocks`);
  }
});

test("slack: encrypted connect, welcome, event fan-out + filter, test send", async () => {
  const sink = await startSink();
  await withWorkspace(async ({ db, workspaceId }) => {
    const cipher = new SecretCipher(randomBytes(32).toString("hex"));
    const integrations = new IntegrationsService(db, cipher);
    const delivery = new DeliveryService(db, cipher);

    // --- 2. ENCRYPT + WELCOME -------------------------------------------------
    // (zod's hooks.slack.com check is controller-level; the service accepts the
    // sink URL directly, which is exactly what we need here.)
    const connected = await integrations.connectSlack(workspaceId, {
      webhookUrl: sink.url,
      events: ["reply", "hot_lead"],
    });
    assert.equal(connected.welcomeDelivered, true, "welcome message delivered");
    assert.ok(
      sink.bodies.some((b) => b.includes("10xConnect connected")),
      "sink received the welcome",
    );
    const row = await db
      .selectFrom("integration_connections")
      .select(["config", "events", "status"])
      .where("workspace_id", "=", workspaceId)
      .where("provider", "=", "slack")
      .executeTakeFirstOrThrow();
    const config = row.config as { webhook_url_enc?: string };
    assert.ok(config.webhook_url_enc, "config carries the encrypted URL");
    assert.notEqual(config.webhook_url_enc, sink.url, "URL is NOT stored in plaintext");
    assert.ok(!JSON.stringify(row.config).includes(sink.url), "plaintext URL absent from config");
    assert.equal(cipher.decrypt(config.webhook_url_enc!), sink.url, "ciphertext decrypts back");

    // --- 3. DELIVER a subscribed event -----------------------------------------
    const event = await db
      .insertInto("integration_events")
      .values({
        workspace_id: workspaceId,
        type: "hot_lead",
        dedupe_key: `slack-hot-${randomUUID()}`,
        payload: JSON.stringify({
          lead: { id: "l1", name: "Ada Lovelace", linkedin_url: "https://linkedin.com/in/ada" },
          summary: "Asked about pricing for 20 seats.",
          next_step: "Book a call",
        }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await delivery.tick();
    const delivered = await waitFor(async () => {
      const d = await db
        .selectFrom("webhook_deliveries")
        .selectAll()
        .where("event_id", "=", event.id)
        .where("target_kind", "=", "slack")
        .executeTakeFirst();
      return d && d.status === "delivered" ? d : null;
    });
    assert.equal(delivered.status, "delivered");
    assert.ok(
      sink.bodies.some((b) => b.includes("Hot lead") && b.includes("Ada Lovelace")),
      "sink received the formatted hot-lead message",
    );

    // --- 4. FILTER: non-subscribed type → no slack delivery ---------------------
    const filtered = await db
      .insertInto("integration_events")
      .values({
        workspace_id: workspaceId,
        type: "campaign_completed",
        dedupe_key: `slack-filter-${randomUUID()}`,
        payload: JSON.stringify({ campaign: { id: "c1", name: "Q3" } }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await delivery.tick();
    await waitFor(async () => {
      const e = await db
        .selectFrom("integration_events")
        .select("processed_at")
        .where("id", "=", filtered.id)
        .executeTakeFirst();
      return e?.processed_at ? e : null;
    });
    const filteredDeliveries = await db
      .selectFrom("webhook_deliveries")
      .select("id")
      .where("event_id", "=", filtered.id)
      .execute();
    assert.equal(filteredDeliveries.length, 0, "unsubscribed event creates no delivery");

    // --- 5. TEST SEND ------------------------------------------------------------
    const testResult = await integrations.testSlack(workspaceId);
    assert.equal(testResult.ok, true, "test message delivered");
    assert.ok(
      sink.bodies.some((b) => b.includes("test notification from 10xConnect")),
      "sink received the test message",
    );
  });
  await sink.close();
});
