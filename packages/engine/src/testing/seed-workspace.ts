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

  // The handle_new_user trigger has already created this user's personal
  // workspace + owner membership. Reuse it (renamed for debuggability) instead
  // of inserting a second workspace.
  const ws = await db
    .updateTable("workspaces")
    .set({ name: `Phase1 Test ${suffix}` })
    .where("owner_id", "=", userId)
    .returning("id")
    .executeTakeFirstOrThrow();

  const cleanup = async (): Promise<void> => {
    // Deleting the auth user cascades: auth.users → profiles → workspaces
    // (owner_id) → all workspace-scoped rows.
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  };

  return { db, userId, workspaceId: ws.id, cleanup };
}
