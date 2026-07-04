// Restriction handling (CLAUDE.md §2/§6): account restriction is a domain event,
// not an error. On detection we set the account 'restricted', drop its health to
// the floor, and raise a notification. The dispatch loop then HOLDS that account's
// actions within one tick (it checks account status before every send), so its
// campaigns effectively auto-pause without needing a campaign 'paused' status.

import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { emitIntegrationEvent } from "./events";

export type AccountIncident = "restricted" | "captcha";

export async function flagAccountIncident(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string,
  incident: AccountIncident,
): Promise<void> {
  const status = incident === "restricted" ? "restricted" : "paused";
  await db
    .updateTable("sending_accounts")
    .set({ status, health_score: incident === "restricted" ? 10 : 40 })
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", accountId)
    .execute();

  const account = await db
    .selectFrom("sending_accounts")
    .select("name")
    .where("id", "=", accountId)
    .executeTakeFirst();
  const name = account?.name ?? "A LinkedIn account";

  await db
    .insertInto("notifications")
    .values({
      workspace_id: workspaceId,
      account_id: accountId,
      type: incident === "restricted" ? "account_restricted" : "account_checkpoint",
      title:
        incident === "restricted"
          ? `${name} was restricted`
          : `${name} hit a checkpoint`,
      body:
        incident === "restricted"
          ? "Its campaigns are paused automatically. Resolve the restriction on LinkedIn, then reconnect."
          : "Sending is paused for safety. Complete the checkpoint, then resume the account.",
    })
    .execute();

  // Integrations outbox: one status_change per account/incident/day (covers the
  // inbound webhook path AND both dispatch-time detection sites in one seam).
  await emitIntegrationEvent(db, {
    workspaceId,
    type: "status_change",
    dedupeKey: `status_change:${accountId}:${incident}:${new Date().toISOString().slice(0, 10)}`,
    payload: {
      account: { id: accountId, name },
      status,
      incident,
    },
  });
}
