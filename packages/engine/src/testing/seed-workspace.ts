// Test-only helper: spin up a throwaway workspace (auth user → profile via the
// handle_new_user trigger → workspace + owner membership) for DB-backed
// integration tests, with a cleanup() that deletes the user (cascading away the
// profile, workspace, and every workspace-scoped row). Service-role only —
// never import from app/runtime code.

import { randomUUID } from "node:crypto";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

export interface SeededWorkspace {
  db: Kysely<DB>;
  userId: string;
  workspaceId: string;
  cleanup: () => Promise<void>;
}

export async function seedWorkspace(): Promise<SeededWorkspace> {
  const admin = createServiceClient();
  const db = createDb();

  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `phase1-${suffix}@10xconnect.test`,
    password: `Pw-${suffix}!`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    await db.destroy();
    throw created.error ?? new Error("failed to create seed user");
  }
  const userId = created.data.user.id;

  // The handle_new_user trigger has already mirrored the auth user into
  // public.profiles, so owner_id below satisfies its FK.
  const ws = await db
    .insertInto("workspaces")
    .values({ name: `Phase1 Test ${suffix}`, owner_id: userId })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("memberships")
    .values({ workspace_id: ws.id, user_id: userId, role: "owner" })
    .execute();

  const cleanup = async (): Promise<void> => {
    // Deleting the auth user cascades: auth.users → profiles → workspaces
    // (owner_id) → all workspace-scoped rows.
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  };

  return { db, userId, workspaceId: ws.id, cleanup };
}
