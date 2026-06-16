import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createPgClient } from "./db-utils";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

async function main(): Promise<void> {
  const client = createPgClient();
  await client.connect();

  try {
    await client.query(`
      create table if not exists public._migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set(
      (await client.query<{ name: string }>("select name from public._migrations")).rows.map(
        (r) => r.name,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`apply  ${file} ...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public._migrations (name) values ($1)", [file]);
        await client.query("commit");
        count += 1;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    console.log(`\nDone. ${count} migration(s) applied, ${files.length - count} already present.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
