// MAINTENANCE (run once): clear stale synced conversations + the contacts synced
// from LinkedIn chats, so the inbox/contacts stop showing a previously-connected
// profile's data (incl. old personal chats). After running, open the app and hit
// "Sync" — it repopulates ONLY the current profile's recent threads under the new
// 30-day / campaign rules.
//
// Deletes, per workspace:
//   - conversations  (messages cascade)
//   - leads whose enrichment.source = 'conversation_sync'  (chat-sourced contacts;
//     list membership + campaign state cascade). Prospect lists imported by
//     search/CSV are KEPT.
//
// Scope: all workspaces by default, or a single one via WORKSPACE_ID=<uuid>.
import { createPgClient } from "./db-utils";

async function main(): Promise<void> {
  const workspaceId = process.env.WORKSPACE_ID?.trim() || null;
  const c = createPgClient();
  await c.connect();
  try {
    const scope = workspaceId ? "workspace_id = $1" : "true";
    const args = workspaceId ? [workspaceId] : [];

    const convos = await c.query(`delete from public.conversations where ${scope}`, args);
    const leads = await c.query(
      `delete from public.leads
       where ${scope} and enrichment->>'source' = 'conversation_sync'`,
      args,
    );

    console.log(
      `reset-synced-inbox${workspaceId ? ` (ws ${workspaceId})` : " (all workspaces)"}: ` +
        `removed ${convos.rowCount} conversation(s) and ${leads.rowCount} chat-sourced contact(s). ` +
        `Re-run Sync in the app to repopulate the current profile's recent threads.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
