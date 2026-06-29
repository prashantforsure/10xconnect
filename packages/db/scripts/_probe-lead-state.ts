// TEMP read-only: the lead's campaign states + which campaigns have a brain, to
// see how handleReply should resolve the conversation's campaign.
import { createPgClient } from "./db-utils";

const LEAD = "cb0267d1-9cae-4fec-8159-85eb52ed434e";

async function main(): Promise<void> {
  const c = createPgClient();
  await c.connect();
  try {
    const r = await c.query(
      `select lcs.campaign_id, cm.name, lcs.status, lcs.updated_at,
              (cm.objective is not null) as has_obj, cm.knowledge_base_id is not null as has_kb
         from public.lead_campaign_state lcs
         join public.campaigns cm on cm.id = lcs.campaign_id
        where lcs.lead_id = $1
        order by lcs.updated_at desc`,
      [LEAD],
    );
    console.log(`lead_campaign_state for lead (most-recent first):`);
    for (const row of r.rows) {
      console.log(`- "${row.name}" status=${row.status} hasObj=${row.has_obj} hasKB=${row.has_kb} updated=${row.updated_at} campaign=${String(row.campaign_id).slice(0,8)}`);
    }
    const rel = await c.query(`select campaign_id, stage, updated_at from public.relationship_state where lead_id=$1`, [LEAD]);
    console.log(`\nrelationship_state: ${rel.rows.length ? JSON.stringify(rel.rows[0]) : "(none)"}`);
    const ev = await c.query(`select type, provider_event_id, created_at from public.lead_events where lead_id=$1 order by created_at desc limit 5`, [LEAD]);
    console.log(`\nrecent lead_events:`);
    for (const row of ev.rows) console.log(`- ${row.type} ${row.provider_event_id} @ ${row.created_at}`);
  } finally {
    await c.end();
  }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
