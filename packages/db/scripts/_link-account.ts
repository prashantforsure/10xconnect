import { createPgClient } from "./db-utils";

// The user's REAL connected LinkedIn account on Unipile (verified live, status OK).
const PROVIDER_ACCOUNT_ID = "ThYaIYExS1a9XPy-AoSS3w";
const ACCOUNT_NAME = "Prashant Patel";
const COUNTRY = "IN";
const USER_EMAIL = "pp9926521681@gmail.com";

async function main(): Promise<void> {
  const client = createPgClient();
  await client.connect();
  try {
    const { rows } = await client.query(
      `select sa.id, sa.workspace_id, w.name as ws_name, sa.provider_account_id, sa.status,
              (select count(*) from public.campaigns c where c.account_id = sa.id) as campaigns
         from public.sending_accounts sa
         join public.memberships m on m.workspace_id = sa.workspace_id
         join public.profiles p on p.id = m.user_id
         join public.workspaces w on w.id = sa.workspace_id
        where sa.type = 'linkedin' and lower(p.email) = lower($1)
        order by campaigns desc, sa.updated_at desc`,
      [USER_EMAIL],
    );

    console.log(`LinkedIn accounts for ${USER_EMAIL}: ${rows.length}`);
    for (const r of rows) {
      console.log(
        `- account=${String(r.id).slice(0, 8)} ws="${r.ws_name}" provider=${r.provider_account_id} status=${r.status} campaigns=${r.campaigns}`,
      );
    }
    if (rows.length === 0) {
      console.log("\nNo LinkedIn account in your workspaces. Tell me which workspace to attach it to.");
      return;
    }

    // Update every one of the user's LinkedIn account rows to the real provider
    // id (one per workspace; they all represent the same real LinkedIn account).
    for (const r of rows) {
      await client.query(
        `update public.sending_accounts
            set provider_account_id = $1, connection_method = 'cookie', status = 'active',
                name = $2, country = $3, health_score = 100, updated_at = now()
          where id = $4`,
        [PROVIDER_ACCOUNT_ID, ACCOUNT_NAME, COUNTRY, r.id],
      );
      console.log(`✅ linked account=${String(r.id).slice(0, 8)} ("${r.ws_name}") → ${PROVIDER_ACCOUNT_ID}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("link failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
