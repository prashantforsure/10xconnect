// TEMP read-only inspection (no writes, no sends). Surfaces the current state of
// the stack so we can plan a safe LIVE Unipile test:
//  - workspaces + LinkedIn sending accounts (status, provider_account_id)
//  - which Unipile accounts actually exist for our API key (validity check)
//  - 'running' campaigns and any PENDING actions queued (the avalanche risk)
//  - whether the target lead (prashant-patel-11198a285) exists
import { env } from "@10xconnect/config";

import { createPgClient } from "./db-utils";

function baseUrl(): string {
  const dsn = (env.UNIPILE_DSN ?? "").trim();
  return /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
}

async function unipileAccounts(): Promise<Map<string, any>> {
  const res = await fetch(baseUrl() + "/api/v1/accounts", {
    method: "GET",
    headers: { "X-API-KEY": env.UNIPILE_API_KEY ?? "", accept: "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as { items?: any[] };
  const m = new Map<string, any>();
  for (const a of data.items ?? []) m.set(a.id, a);
  console.log(`Unipile GET /accounts → ${res.status}, ${data.items?.length ?? 0} account(s) on this API key`);
  for (const a of data.items ?? []) {
    console.log(
      `  • account_id=${a.id} name=${a.name} status=${JSON.stringify((a.sources ?? []).map((s: any) => s.status))} publicId=${a.connection_params?.im?.publicIdentifier}`,
    );
  }
  return m;
}

async function main(): Promise<void> {
  const uni = await unipileAccounts();

  const client = createPgClient();
  await client.connect();
  try {
    const { rows: accounts } = await client.query(
      `select sa.id, sa.workspace_id, w.name as ws_name, sa.type, sa.status,
              sa.provider_account_id, sa.name, sa.country, sa.connection_method
         from public.sending_accounts sa
         join public.workspaces w on w.id = sa.workspace_id
        where sa.type = 'linkedin'
        order by w.name`,
    );
    console.log(`\n=== LinkedIn sending_accounts (${accounts.length}) ===`);
    for (const a of accounts) {
      const live = a.provider_account_id ? uni.get(a.provider_account_id) : null;
      const liveTag = a.provider_account_id
        ? live
          ? `LIVE-OK status=${JSON.stringify((live.sources ?? []).map((s: any) => s.status))}`
          : `STALE (not on this Unipile key)`
        : `no provider_account_id`;
      console.log(
        `- ws="${a.ws_name}" acct=${String(a.id).slice(0, 8)} status=${a.status} method=${a.connection_method} provider=${a.provider_account_id} → ${liveTag}`,
      );
    }

    const { rows: campaigns } = await client.query(
      `select c.id, c.name, c.status, c.account_id, w.name as ws_name,
              (select count(*) from public.lead_campaign_state lcs where lcs.campaign_id = c.id) as leads,
              (select count(*) from public.actions a where a.campaign_id = c.id and a.status = 'pending') as pending_actions
         from public.campaigns c
         join public.workspaces w on w.id = c.workspace_id
        order by c.status, c.name`,
    );
    console.log(`\n=== campaigns (${campaigns.length}) ===`);
    for (const c of campaigns) {
      console.log(
        `- ws="${c.ws_name}" "${c.name}" status=${c.status} leads=${c.leads} pendingActions=${c.pending_actions} id=${String(c.id).slice(0, 8)}`,
      );
    }

    const { rows: pend } = await client.query(
      `select count(*)::int as n from public.actions where status = 'pending'`,
    );
    const { rows: pendDue } = await client.query(
      `select count(*)::int as n from public.actions where status = 'pending' and scheduled_at <= now()`,
    );
    console.log(`\n=== actions queue ===`);
    console.log(`pending total=${pend[0].n}  pending & DUE now=${pendDue[0].n}  (these would send the instant the worker runs with DISPATCH_ENABLED=true + ADAPTER=unipile)`);

    const { rows: leads } = await client.query(
      `select l.id, l.workspace_id, w.name as ws_name, l.linkedin_url, l.email, l.connection_degree, l.enrich_status
         from public.leads l
         join public.workspaces w on w.id = l.workspace_id
        where l.linkedin_url ilike '%prashant-patel-11198a285%'`,
    );
    console.log(`\n=== target lead match (prashant-patel-11198a285): ${leads.length} ===`);
    for (const l of leads) {
      console.log(
        `- ws="${l.ws_name}" lead=${String(l.id).slice(0, 8)} url=${l.linkedin_url} degree=${l.connection_degree} enrich=${l.enrich_status}`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("inspect failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
