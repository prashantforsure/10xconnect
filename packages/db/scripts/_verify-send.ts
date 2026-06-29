// TEMP read-only: show the opener action's persisted ActionResult (provider ref =
// proof Unipile accepted the live send).
import { createPgClient } from "./db-utils";

async function main(): Promise<void> {
  const c = createPgClient();
  await c.connect();
  try {
    const r = await c.query(
      `select type, status, result from public.actions
        where campaign_id = 'c2bb7f56-9c80-4d95-9630-7d3f009c9313' order by created_at`,
    );
    for (const row of r.rows) {
      console.log(`${row.type} ${row.status} | result=${JSON.stringify(row.result)}`);
    }
  } finally {
    await c.end();
  }
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
