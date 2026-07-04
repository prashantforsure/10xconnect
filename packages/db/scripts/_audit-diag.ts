// AUDIT TOOLING (throwaway): diagnose the non-SIMULATED success + action types.
import { createPgClient } from "./db-utils";

const ws = "e42228e4-7269-4318-8921-401139bdc3f1";

async function main(): Promise<void> {
  const pg = createPgClient();
  await pg.connect();
  const off = await pg.query(
    `select id, type, status, result from public.actions
     where workspace_id=$1 and status='success' and (result->>'providerRef') is distinct from 'SIMULATED'`,
    [ws],
  );
  console.log("NON-SIMULATED successes:", off.rowCount);
  for (const r of off.rows) console.log("  type=" + r.type + " result=" + JSON.stringify(r.result));

  const bytype = await pg.query(
    `select type, status, (result->>'providerRef') ref, count(*)::int n from public.actions
     where workspace_id=$1 group by type,status,(result->>'providerRef') order by type,status`,
    [ws],
  );
  console.log("\nALL actions by type/status/ref:");
  for (const r of bytype.rows) console.log("  " + r.type + " " + r.status + " ref=" + (r.ref ?? "NULL") + " x" + r.n);
  await pg.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
