// Test gate — API keys v2 + public-API key auth (integrations build, Phase A).
//
// Drives the REAL ApiKeysService + ApiKeyAuthService against the dev Postgres:
//   1. CREATE    — plaintext returned once; list shows name/permission/prefix.
//   2. AUTH      — the plaintext authorizes and resolves the key's workspace.
//   3. READ-ONLY — a read_only key is rejected on non-GET methods (403).
//   4. DENYLIST  — identity/money routes are unreachable with any key (403).
//   5. INVALID   — an unknown key is rejected (401).
//   6. RATE      — the 61st call inside one window throws 429.
//   7. SCOPE-GUARD — WorkspaceScopeGuard short-circuits for key requests:
//      no header → workspace pinned; mismatching header → 403.
//   8. RENAME    — PATCH path updates the name.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import { ForbiddenException, HttpException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Kysely } from "kysely";

import { ApiKeyAuthService } from "../auth/api-key-auth.service";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

import { ApiKeysService } from "./api-keys.module";

async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string; userId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `apikeys-${suffix}@10xconnect.test`,
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
      .values({ name: `ApiKeys ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("memberships")
      .values({ workspace_id: ws.id, user_id: userId, role: "owner" })
      .execute();
    await body({ db, workspaceId: ws.id, userId });
  } finally {
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  }
}

/** Minimal ExecutionContext around a fake request (guard-level check). */
function fakeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

test("api keys v2: create/auth/read-only/denylist/rate-limit/scope-guard/rename", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const keysSvc = new ApiKeysService(db);
    const auth = new ApiKeyAuthService(db);

    // --- 1. CREATE ----------------------------------------------------------
    const createdAll = await keysSvc.create(workspaceId, { name: "Zapier" });
    assert.ok(createdAll.key.startsWith("10xc_"), "plaintext key returned once");
    assert.equal(createdAll.permission, "all");
    const createdRo = await keysSvc.create(workspaceId, {
      name: "Reporting",
      permission: "read_only",
    });
    const listed = await keysSvc.list(workspaceId);
    assert.equal(listed.length, 2, "both keys listed");
    const roRow = listed.find((k) => k.name === "Reporting");
    assert.equal(roRow?.permission, "read_only", "permission persisted");
    assert.equal(roRow?.prefix, createdRo.key.slice(0, 12), "display prefix stored");

    // --- 2. AUTH — key resolves its workspace -------------------------------
    const principal = await auth.authorize(createdAll.key, "GET", "/api/v1/campaigns");
    assert.equal(principal.workspaceId, workspaceId, "key pins the workspace");
    assert.equal(principal.permission, "all");

    // --- 3. READ-ONLY — non-GET rejected -------------------------------------
    await auth.authorize(createdRo.key, "GET", "/api/v1/campaigns"); // reads OK
    await assert.rejects(
      () => auth.authorize(createdRo.key, "POST", "/api/v1/campaigns"),
      ForbiddenException,
      "read_only key rejected on POST",
    );

    // --- 4. DENYLIST — identity/money routes unreachable ----------------------
    for (const path of ["/api/v1/billing/subscription", "/api/v1/api-keys", "/api/v1/me"]) {
      await assert.rejects(
        () => auth.authorize(createdAll.key, "GET", path),
        ForbiddenException,
        `denylisted for keys: ${path}`,
      );
    }

    // --- 5. INVALID key ------------------------------------------------------
    await assert.rejects(
      () => auth.authorize("10xc_definitely-not-a-real-key", "GET", "/api/v1/campaigns"),
      UnauthorizedException,
      "unknown key rejected",
    );

    // --- 6. RATE LIMIT — 61st call in the window throws 429 -------------------
    // (2 calls already spent above on createdAll; use a fresh key for a clean count.)
    const rlKey = await keysSvc.create(workspaceId, { name: "RateLimit" });
    for (let i = 0; i < 60; i++) {
      await auth.authorize(rlKey.key, "GET", "/api/v1/campaigns");
    }
    await assert.rejects(
      () => auth.authorize(rlKey.key, "GET", "/api/v1/campaigns"),
      (err: unknown) => err instanceof HttpException && err.getStatus() === 429,
      "61st call inside the window is rate-limited",
    );

    // --- 7. SCOPE GUARD — apiKey short-circuit --------------------------------
    const guard = new WorkspaceScopeGuard(db);
    const reqNoHeader: Record<string, unknown> = {
      apiKey: { keyId: "k", workspaceId, permission: "all" },
      headers: {},
    };
    assert.equal(await guard.canActivate(fakeContext(reqNoHeader)), true);
    assert.equal(reqNoHeader.workspaceId, workspaceId, "workspace pinned without header");
    const reqMismatch = {
      apiKey: { keyId: "k", workspaceId, permission: "all" },
      headers: { "x-workspace-id": randomUUID() },
    };
    await assert.rejects(
      () => guard.canActivate(fakeContext(reqMismatch)),
      ForbiddenException,
      "mismatching X-Workspace-Id rejected",
    );

    // --- 8. RENAME -----------------------------------------------------------
    const renamed = await keysSvc.rename(workspaceId, createdAll.id, "Zapier (prod)");
    assert.equal(renamed.name, "Zapier (prod)");

    // last_used_at was stamped by authorize (fire-and-forget → allow a beat).
    await new Promise((r) => setTimeout(r, 300));
    const after = await keysSvc.list(workspaceId);
    const usedRow = after.find((k) => k.id === createdAll.id);
    assert.ok(usedRow?.lastUsedAt, "last_used_at stamped after use");
  });
});
