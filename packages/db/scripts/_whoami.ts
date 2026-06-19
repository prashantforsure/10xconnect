import { createPgClient } from "./db-utils";

function s(v: unknown, n = 8): string {
  return v == null ? "—" : String(v).slice(0, n);
}

async function main(): Promise<void> {
  const client = createPgClient();
  await client.connect();
  try {
    const profiles = await client.query(`select id, email, name from public.profiles order by created_at`);
    console.log(`\n=== profiles (${profiles.rowCount}) ===`);
    for (const p of profiles.rows) {
      console.log(`${s(p.id)}  ${p.email}  (${p.name ?? ""})`);
    }

    const ws = await client.query(`
      select w.id, w.name, w.owner_id, pr.email as owner_email,
             (select count(*) from public.memberships m where m.workspace_id = w.id) as members,
             (select count(*) from public.sending_accounts sa where sa.workspace_id = w.id and sa.type='linkedin') as li_accounts,
             (select count(*) from public.campaigns c where c.workspace_id = w.id) as campaigns,
             (select count(*) from public.leads l where l.workspace_id = w.id) as leads
      from public.workspaces w
      left join public.profiles pr on pr.id = w.owner_id
      order by w.created_at
    `);
    console.log(`\n=== workspaces (${ws.rowCount}) ===`);
    for (const w of ws.rows) {
      console.log(
        `${s(w.id)}  "${w.name}"  owner=${w.owner_email ?? s(w.owner_id)}  members=${w.members} li=${w.li_accounts} campaigns=${w.campaigns} leads=${w.leads}`,
      );
    }

    const mem = await client.query(`
      select pr.email, w.id as ws_id, w.name as ws_name, m.role
      from public.memberships m
      join public.profiles pr on pr.id = m.user_id
      join public.workspaces w on w.id = m.workspace_id
      where lower(pr.email) like '%pgayurved%' or lower(pr.email) like '%prashant%' or lower(pr.email) like '%pp99%'
      order by pr.email
    `);
    console.log(`\n=== memberships for likely-you accounts (${mem.rowCount}) ===`);
    for (const m of mem.rows) {
      console.log(`${m.email}  →  ws=${s(m.ws_id)} "${m.ws_name}" (${m.role})`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("whoami failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
