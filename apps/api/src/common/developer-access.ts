import { isDeveloperEmail } from "@10xconnect/config";
import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

/**
 * Developer-access bypass. A workspace whose OWNER's email is on the developer
 * allowlist (DEVELOPER_EMAILS + built-in defaults) is treated as fully unlocked:
 * unlimited sending-account slots and an always-"active" (free) subscription, so a
 * developer can exercise the whole product — locally AND in production — without
 * paying or hitting the one-account cap. Scoped to the owner's email, so a normal
 * customer's workspace is never affected.
 *
 * Resolves the owner via workspaces.owner_id → profiles.email (profiles mirrors
 * auth.users, populated by the handle_new_user trigger).
 */
export async function isDeveloperWorkspace(db: Kysely<DB>, workspaceId: string): Promise<boolean> {
  const row = await db
    .selectFrom("workspaces")
    .innerJoin("profiles", "profiles.id", "workspaces.owner_id")
    .select("profiles.email as email")
    .where("workspaces.id", "=", workspaceId)
    .executeTakeFirst();
  return isDeveloperEmail(row?.email ?? null);
}
