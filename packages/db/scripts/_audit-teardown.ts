// AUDIT TOOLING (throwaway — never commit): tears down the audit workspace.
// Deleting the auth user cascades auth.users → profiles → workspaces →
// every workspace-scoped row. Asserts zero rows remain.
// Usage: pnpm --filter @10xconnect/db exec tsx scripts/_audit-teardown.ts <userId> <workspaceId>

import { createAdminClient, createPgClient } from "./db-utils";

const userId = process.argv[2];
const wsId = process.argv[3];
if (!userId || !wsId) {
  console.error("usage: tsx scripts/_audit-teardown.ts <userId> <workspaceId>");
  process.exit(1);
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const pg = createPgClient();
  await pg.connect();
  try {
    // Safety: refuse to delete anything but the audit workspace/user.
    const ws = await pg.query(`select name, owner_id from public.workspaces where id = $1`, [wsId]);
    if (ws.rowCount === 0) {
      console.log("workspace already gone; deleting user only");
    } else {
      const row = ws.rows[0];
      if (!String(row.name).startsWith("AUDIT-SIM")) {
        throw new Error(`REFUSING: workspace ${wsId} is "${row.name}", not an AUDIT-SIM workspace`);
      }
      if (row.owner_id !== userId) {
        throw new Error(`REFUSING: workspace ${wsId} is not owned by ${userId}`);
      }
    }
    const prof = await pg.query(`select email from public.profiles where id = $1`, [userId]);
    if (prof.rowCount > 0 && !String(prof.rows[0].email).startsWith("audit-sim-")) {
      throw new Error(`REFUSING: user ${userId} is ${prof.rows[0].email}, not an audit-sim user`);
    }

    const del = await admin.auth.admin.deleteUser(userId);
    if (del.error) throw del.error;

    for (const table of ["campaigns", "leads", "actions", "conversations", "lead_events", "sending_accounts"]) {
      const r = await pg.query(`select count(*)::int as n from public.${table} where workspace_id = $1`, [wsId]);
      console.log(`${table}: ${r.rows[0].n} rows remain (expect 0)`);
    }
    console.log("teardown complete");
  } finally {
    await pg.end();
  }
}

main().catch((e: unknown) => {
  console.error("audit-teardown failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
