// AUDIT TOOLING (throwaway — never commit): observation instrument for the
// audit workspace. Usage:
//   pnpm --filter @10xconnect/db exec tsx scripts/_audit-inspect.ts <workspaceId> [section]
// Sections: all (default) | campaigns | states | actions | events | convos | account | a1
// "a1" runs the standing real-send assertion (must print REAL_SENDS=0).

import { createPgClient } from "./db-utils";

const wsId = process.argv[2];
const section = process.argv[3] ?? "all";
if (!wsId) {
  console.error("usage: tsx scripts/_audit-inspect.ts <workspaceId> [section]");
  process.exit(1);
}

function j(v: unknown): string {
  return v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v);
}

async function main(): Promise<void> {
  const pg = createPgClient();
  await pg.connect();
  try {
    const want = (s: string) => section === "all" || section === s;

    if (want("a1")) {
      const a1 = await pg.query(
        `select count(*)::int as real_sends from public.actions
         where workspace_id = $1 and status = 'success'
           and (result->>'providerRef') is distinct from 'SIMULATED'`,
        [wsId],
      );
      console.log(`REAL_SENDS=${a1.rows[0].real_sends}`);
      const foreign = await pg.query(
        `select count(*)::int as n from public.actions a
         where a.workspace_id = $1
           and a.account_id is not null
           and not exists (select 1 from public.sending_accounts sa
                           where sa.id = a.account_id and sa.workspace_id = $1)`,
        [wsId],
      );
      console.log(`FOREIGN_ACCOUNT_ACTIONS=${foreign.rows[0].n}`);
    }

    if (want("campaigns")) {
      const rows = await pg.query(
        `select id, name, status, account_id, settings from public.campaigns where workspace_id = $1 order by created_at`,
        [wsId],
      );
      console.log(`\n=== campaigns (${rows.rowCount}) ===`);
      for (const r of rows.rows) console.log(`${r.id}  "${r.name}"  ${r.status}  settings=${j(r.settings)}`);
    }

    if (want("states")) {
      const rows = await pg.query(
        `select s.campaign_id, c.name as campaign, s.lead_id, l.enrichment->>'firstName' as lead,
                s.status, s.current_node_id,
                (select n.type from public.sequence_nodes n where n.id = s.current_node_id) as node_type,
                jsonb_array_length(coalesce(s.history, '[]'::jsonb)) as hist_len
         from public.lead_campaign_state s
         join public.campaigns c on c.id = s.campaign_id
         join public.leads l on l.id = s.lead_id
         where c.workspace_id = $1
         order by c.created_at, l.created_at`,
        [wsId],
      );
      console.log(`\n=== lead_campaign_state (${rows.rowCount}) ===`);
      for (const r of rows.rows)
        console.log(`${r.campaign}  ${r.lead}  status=${r.status}  node=${r.node_type ?? "—"}(${(r.current_node_id ?? "").slice(0, 8)})  hist=${r.hist_len}`);
    }

    if (want("actions")) {
      const rows = await pg.query(
        `select a.id, a.type, a.status, a.attempts, a.scheduled_at, a.executed_at,
                a.result->>'providerRef' as provider_ref,
                l.enrichment->>'firstName' as lead,
                c.name as campaign
         from public.actions a
         left join public.leads l on l.id = a.lead_id
         left join public.campaigns c on c.id = a.campaign_id
         where a.workspace_id = $1
         order by a.scheduled_at nulls last, a.created_at`,
        [wsId],
      );
      console.log(`\n=== actions (${rows.rowCount}) ===`);
      for (const r of rows.rows)
        console.log(
          `${String(r.id).slice(0, 8)}  ${r.type}  ${r.status}  lead=${r.lead ?? "—"}  camp=${r.campaign ?? "—"}  sched=${r.scheduled_at?.toISOString?.() ?? r.scheduled_at}  ref=${r.provider_ref ?? "—"}  att=${r.attempts}`,
        );
    }

    if (want("events")) {
      const rows = await pg.query(
        `select e.type, e.provider_event_id, e.occurred_at, l.enrichment->>'firstName' as lead
         from public.lead_events e
         left join public.leads l on l.id = e.lead_id
         where e.workspace_id = $1 order by e.occurred_at`,
        [wsId],
      );
      console.log(`\n=== lead_events (${rows.rowCount}) ===`);
      for (const r of rows.rows) console.log(`${r.type}  lead=${r.lead ?? "—"}  ev=${r.provider_event_id}  at=${j(r.occurred_at)}`);
    }

    if (want("convos")) {
      const convos = await pg.query(
        `select cv.id, l.enrichment->>'firstName' as lead, cv.pipeline_stage, cv.needs_attention
         from public.conversations cv
         left join public.leads l on l.id = cv.lead_id
         where cv.workspace_id = $1 order by cv.created_at`,
        [wsId],
      );
      console.log(`\n=== conversations (${convos.rowCount}) ===`);
      for (const r of convos.rows) console.log(`${r.id}  lead=${r.lead}  stage=${r.pipeline_stage}  attention=${r.needs_attention}`);
      const msgs = await pg.query(
        `select m.conversation_id, m.direction, m.authored_by, left(m.body, 80) as body, m.created_at
         from public.messages m
         join public.conversations cv on cv.id = m.conversation_id
         where cv.workspace_id = $1 order by m.created_at`,
        [wsId],
      );
      console.log(`\n=== messages (${msgs.rowCount}) ===`);
      for (const r of msgs.rows)
        console.log(`${String(r.conversation_id).slice(0, 8)}  ${r.direction}/${r.authored_by ?? "—"}  "${r.body}"`);
      const drafts = await pg.query(
        `select d.id, d.conversation_id, d.status, left(d.body, 80) as body
         from public.message_drafts d
         join public.conversations cv on cv.id = d.conversation_id
         where cv.workspace_id = $1 order by d.created_at`,
        [wsId],
      ).catch(() => ({ rowCount: -1, rows: [] as any[] }));
      if (drafts.rowCount >= 0) {
        console.log(`\n=== message_drafts (${drafts.rowCount}) ===`);
        for (const r of drafts.rows) console.log(`${String(r.id).slice(0, 8)}  conv=${String(r.conversation_id).slice(0, 8)}  ${r.status}  "${r.body}"`);
      }
    }

    if (want("account")) {
      const rows = await pg.query(
        `select id, name, status, health_score, warmup_state from public.sending_accounts where workspace_id = $1`,
        [wsId],
      );
      console.log(`\n=== sending_accounts (${rows.rowCount}) ===`);
      for (const r of rows.rows) console.log(`${r.id}  "${r.name}"  ${r.status}  health=${r.health_score}  warmup=${j(r.warmup_state)}`);
      const notifs = await pg.query(
        `select type, title, created_at from public.notifications where workspace_id = $1 order by created_at desc limit 10`,
        [wsId],
      ).catch(() => ({ rowCount: -1, rows: [] as any[] }));
      if (notifs.rowCount >= 0) {
        console.log(`\n=== notifications (${notifs.rowCount}) ===`);
        for (const r of notifs.rows) console.log(`${r.type}  "${r.title}"  ${j(r.created_at)}`);
      }
    }
  } finally {
    await pg.end();
  }
}

main().catch((e: unknown) => {
  console.error("audit-inspect failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
