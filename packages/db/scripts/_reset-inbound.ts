// TEMP: reset ONLY the inbound side of the live-scenario lead so the recipient's
// already-consumed replies reprocess through the fixed handleReply. Scoped to the
// one test lead in ws "xyz" — deletes its conversation/messages/drafts/events/
// relationship, leaving the campaign, sending account, and outbound opener intact.
import { createPgClient } from "./db-utils";

const LEAD = "cb0267d1-9cae-4fec-8159-85eb52ed434e";

async function main(): Promise<void> {
  const c = createPgClient();
  await c.connect();
  try {
    const convos = await c.query(`select id from public.conversations where lead_id=$1`, [LEAD]);
    const ids = convos.rows.map((r) => r.id);
    for (const id of ids) {
      await c.query(`delete from public.message_drafts where conversation_id=$1`, [id]);
      await c.query(`delete from public.messages where conversation_id=$1`, [id]);
    }
    await c.query(`delete from public.conversations where lead_id=$1`, [LEAD]);
    await c.query(`delete from public.relationship_state where lead_id=$1`, [LEAD]);
    const ev = await c.query(`delete from public.lead_events where lead_id=$1 and type='reply'`, [LEAD]);
    console.log(`reset: removed ${ids.length} conversation(s), relationship, ${ev.rowCount} reply event(s). Outbound opener + campaign untouched.`);
  } finally {
    await c.end();
  }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
