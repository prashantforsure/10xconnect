// Test gate — saved workflows (builder-only) backend wiring.
//
// Drives the REAL WorkflowsService against the dev Postgres and proves:
//   1. STRIP   — saving a builder canvas keeps the SHAPE only; sender/account
//      bindings, media/voice refs, and resolved/per-contact cache are dropped.
//      The message SKELETON (body) is kept.
//   2. SCOPE   — list is workspace-scoped (another workspace never sees it).
//   3. DELETE  — remove deletes the saved workflow.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { WorkflowsService } from "./workflows.module";

async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string; userId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `wf-saved-${suffix}@10xconnect.test`,
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
      .values({ name: `WF Saved ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.insertInto("memberships").values({ workspace_id: ws.id, user_id: userId, role: "owner" }).execute();
    await body({ db, workspaceId: ws.id, userId });
  } finally {
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  }
}

test("saved workflows: save strips sensitive data, list is workspace-scoped, delete removes it", async () => {
  await withWorkspace(async ({ db, workspaceId, userId }) => {
    const svc = new WorkflowsService(db);

    // --- 1. STRIP -----------------------------------------------------------
    const saved = await svc.save(workspaceId, userId, {
      name: "3-touch connector",
      graph: [
        {
          id: "a",
          kind: "action",
          type: "send_connection_request",
          config: {},
          next: "b",
          true: null,
          false: null,
          delayDays: null,
        },
        {
          id: "b",
          kind: "action",
          type: "send_message",
          // Sensitive sender/media/resolved keys that MUST be stripped:
          config: {
            body: "Hi {first_name}",
            senders: ["acct-secret-123"],
            audioRef: "audio-secret-123",
            resolved: { perContact: "cached preview text" },
          },
          next: null,
          true: null,
          false: null,
          delayDays: null,
        },
      ],
    });
    assert.equal(saved.graph.length, 2, "graph shape captured");
    const serialized = JSON.stringify(saved).toLowerCase();
    assert.ok(!serialized.includes("senders"), "sender bindings stripped");
    assert.ok(!serialized.includes("acct-secret-123"), "account id stripped");
    assert.ok(!serialized.includes("audioref"), "voice/media refs stripped");
    assert.ok(!serialized.includes("resolved"), "resolved per-contact cache stripped");
    const msg = saved.graph.find((n) => n.type === "send_message");
    assert.ok(msg && (msg.config as { body?: string }).body === "Hi {first_name}", "message SKELETON kept");
    // Edges preserved.
    const connect = saved.graph.find((n) => n.type === "send_connection_request");
    assert.equal(connect?.next, "b", "edges preserved");

    // --- 2. SCOPE -----------------------------------------------------------
    const mine = await svc.list(workspaceId);
    assert.equal(mine.length, 1, "one saved workflow in this workspace");
    assert.equal(mine[0].id, saved.id);
    const otherWorkspace = await svc.list(randomUUID());
    assert.equal(otherWorkspace.length, 0, "a different workspace sees none");

    // --- 3. DELETE ----------------------------------------------------------
    await svc.remove(workspaceId, saved.id);
    assert.equal((await svc.list(workspaceId)).length, 0, "deleted");
  });
});
