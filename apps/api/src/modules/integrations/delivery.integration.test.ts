// Test gate — outbound webhook delivery (integrations Phase B). DB-backed +
// a LOCAL http sink. Proves:
//   1. DELIVERED — event → fan-out → POST; the sink receives the signed
//      envelope and the HMAC verifies against the secret returned ONCE.
//   2. RETRY     — a 500 sink leaves the delivery pending with attempt=1 and a
//      future next_attempt_at (30s backoff).
//   3. EXHAUSTED — after the final backoff attempt fails, the delivery goes
//      terminal `failed`.
//   4. FILTER    — a webhook not subscribed to the event type gets no delivery.
//   5. TEST SEND — the settings-page test endpoint hits the sink immediately.
//
// NOTE: assertions poll DB state — the dev API's own poller may claim rows
// concurrently (SKIP LOCKED makes that safe; the outcome is identical).
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { SecretCipher } from "../../common/crypto/secret-cipher";
import { WebhooksService } from "../webhooks.module";

import { DeliveryService } from "./delivery.service";
import { signBody } from "./webhook-sender";

interface SinkRequest {
  headers: IncomingMessage["headers"];
  body: string;
}

/** Local HTTP sink: records requests, responds with a configurable status. */
async function startSink(): Promise<{
  url: string;
  requests: SinkRequest[];
  setStatus: (code: number) => void;
  close: () => Promise<void>;
}> {
  const requests: SinkRequest[] = [];
  let status = 200;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      requests.push({ headers: req.headers, body });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 400 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("sink failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    requests,
    setStatus: (code) => (status = code),
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
    email: `delivery-${suffix}@10xconnect.test`,
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
      .values({ name: `Delivery ${suffix}`, owner_id: userId })
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

test("webhook delivery: signed delivery, retry backoff, exhaustion, event filter, test send", async () => {
  const sink = await startSink();
  await withWorkspace(async ({ db, workspaceId }) => {
    const cipher = new SecretCipher(randomBytes(32).toString("hex"));
    const webhooks = new WebhooksService(db, cipher);
    const delivery = new DeliveryService(db, cipher);

    // Subscribed hook + a NON-subscribed hook (filter check).
    const hook = await webhooks.create(workspaceId, {
      name: "Sink",
      url: sink.url,
      events: ["reply", "hot_lead"],
      authHeaderName: "X-Test-Auth",
      authHeaderValue: "token-123",
    });
    assert.ok(hook.secret.startsWith("whsec_"), "signing secret returned once");
    await webhooks.create(workspaceId, {
      name: "Other",
      url: `${sink.url}-other`,
      events: ["campaign_completed"],
    });

    // --- 1. DELIVERED (signed + custom auth header) ---------------------------
    const event = await db
      .insertInto("integration_events")
      .values({
        workspace_id: workspaceId,
        type: "reply",
        dedupe_key: `test-reply-${randomUUID()}`,
        payload: JSON.stringify({ lead: { id: "l1", name: "Test" }, message: { body: "hi" } }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await delivery.tick();
    const delivered = await waitFor(async () => {
      const row = await db
        .selectFrom("webhook_deliveries")
        .selectAll()
        .where("event_id", "=", event.id)
        .where("webhook_id", "=", hook.id)
        .executeTakeFirst();
      return row && row.status === "delivered" ? row : null;
    });
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.response_code, 200);

    // Only ONE delivery row exists for the event (the other hook is filtered out).
    const allForEvent = await db
      .selectFrom("webhook_deliveries")
      .select("id")
      .where("event_id", "=", event.id)
      .execute();
    assert.equal(allForEvent.length, 1, "non-subscribed webhook got no delivery");

    // Sink got the envelope; verify HMAC with the once-returned secret.
    const received = sink.requests.find((r) => r.body.includes(event.id));
    assert.ok(received, "sink received the delivery");
    const envelope = JSON.parse(received.body) as { id: string; type: string; data: unknown };
    assert.equal(envelope.id, event.id);
    assert.equal(envelope.type, "reply");
    assert.equal(received.headers["x-10xc-event"], "reply");
    assert.equal(received.headers["x-test-auth"], "token-123", "custom auth header decrypted+sent");
    const signature = received.headers["x-10xc-signature"];
    assert.ok(typeof signature === "string", "signature header present");
    const [tPart, vPart] = (signature as string).split(",");
    const t = Number(tPart.replace("t=", ""));
    const v1 = vPart.replace("v1=", "");
    assert.equal(v1, signBody(hook.secret, t, received.body), "HMAC verifies against the secret");

    // --- 2. RETRY on 500 -------------------------------------------------------
    sink.setStatus(500);
    const failEvent = await db
      .insertInto("integration_events")
      .values({
        workspace_id: workspaceId,
        type: "hot_lead",
        dedupe_key: `test-hot-${randomUUID()}`,
        payload: JSON.stringify({ summary: "hot" }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await delivery.tick();
    const retrying = await waitFor(async () => {
      const row = await db
        .selectFrom("webhook_deliveries")
        .selectAll()
        .where("event_id", "=", failEvent.id)
        .executeTakeFirst();
      return row && row.attempt >= 1 && row.status === "pending" && row.response_code === 500
        ? row
        : null;
    });
    assert.equal(retrying.status, "pending", "failed attempt stays pending for retry");
    assert.ok(
      new Date(retrying.next_attempt_at).getTime() > Date.now() + 10_000,
      "backoff pushed next_attempt_at into the future",
    );

    // --- 3. EXHAUSTED → terminal failed ---------------------------------------
    // Fast-forward: pretend 6 attempts already happened; the next failure is final.
    await db
      .updateTable("webhook_deliveries")
      .set({ attempt: 6, next_attempt_at: new Date(Date.now() - 1000).toISOString() })
      .where("id", "=", retrying.id)
      .execute();
    await delivery.deliverDue();
    const failed = await waitFor(async () => {
      const row = await db
        .selectFrom("webhook_deliveries")
        .selectAll()
        .where("id", "=", retrying.id)
        .executeTakeFirst();
      return row && row.status === "failed" ? row : null;
    });
    assert.equal(failed.status, "failed", "delivery terminal after backoff exhaustion");

    // --- 5. TEST SEND -----------------------------------------------------------
    sink.setStatus(200);
    const testResult = await webhooks.sendTest(workspaceId, hook.id);
    assert.equal(testResult.ok, true, "test send delivered");
    assert.ok(
      sink.requests.some((r) => r.body.includes('"test":true')),
      "sink received the test event",
    );
  });
  await sink.close();
});
