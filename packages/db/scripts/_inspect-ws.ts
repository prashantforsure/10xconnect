// TEMP read-only: who owns/belongs to ws "xyz" (frontend visibility) + the lead's
// provider id (needed to poll its conversation) + the account warmup/schedule.
import { createPgClient } from "./db-utils";

async function main(): Promise<void> {
  const client = createPgClient();
  await client.connect();
  try {
    const { rows: members } = await client.query(
      `select w.id as ws_id, w.name as ws_name, w.owner_id, m.role, p.email, p.name
         from public.workspaces w
         join public.memberships m on m.workspace_id = w.id
         join public.profiles p on p.id = m.user_id
        where w.name = 'xyz'
        order by m.role`,
    );
    console.log(`=== ws "xyz" members ===`);
    for (const r of members) {
      console.log(`- ${r.email} (${r.name}) role=${r.role} ws_id=${r.ws_id}`);
    }

    const { rows: lead } = await client.query(
      `select l.id, l.linkedin_url, l.enrichment->>'providerId' as provider_id,
              l.enrichment->>'firstName' as first_name, l.enrichment->>'headline' as headline,
              l.connection_degree
         from public.leads l
        where l.linkedin_url ilike '%prashant-patel-11198a285%'`,
    );
    console.log(`\n=== target lead ===`);
    for (const r of lead) {
      console.log(`- id=${r.id} provider_id=${r.provider_id} first=${r.first_name} degree=${r.connection_degree} headline=${(r.headline ?? "").slice(0,60)}`);
    }

    const { rows: acct } = await client.query(
      `select id, status, provider_account_id, warmup_state, name
         from public.sending_accounts
        where workspace_id = (select id from public.workspaces where name='xyz' limit 1)
          and type='linkedin'`,
    );
    console.log(`\n=== xyz LinkedIn account ===`);
    for (const r of acct) {
      console.log(`- id=${r.id} status=${r.status} provider=${r.provider_account_id} warmup=${JSON.stringify(r.warmup_state)}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("inspect-ws failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
