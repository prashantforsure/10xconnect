import { type Client } from "pg";

import { createAdminClient, createPgClient } from "./db-utils";

// Simulate a logged-in user: set the JWT claims + the `authenticated` role so
// auth.uid() resolves and RLS policies apply, run a query, then roll back.
async function asUser<T extends Record<string, unknown>>(
  pg: Client,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await pg.query("begin");
  try {
    await pg.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await pg.query("set local role authenticated");
    const res = await pg.query<T>(sql, params);
    return res.rows;
  } finally {
    await pg.query("rollback");
  }
}

async function asServiceRole<T extends Record<string, unknown>>(
  pg: Client,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await pg.query("begin");
  try {
    await pg.query("set local role service_role");
    const res = await pg.query<T>(sql, params);
    return res.rows;
  } finally {
    await pg.query("rollback");
  }
}

const COUNT_LEADS = "select count(*)::int as count from public.leads where workspace_id = $1";

async function main(): Promise<void> {
  const admin = createAdminClient();
  const pg = createPgClient();
  await pg.connect();

  const stamp = Date.now();
  const emailA = `rls-a-${stamp}@10xconnect.test`;
  const emailB = `rls-b-${stamp}@10xconnect.test`;
  let userA: string | undefined;
  let userB: string | undefined;

  const results: { name: string; pass: boolean; detail: string }[] = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    results.push({ name, pass, detail });
  };

  try {
    // --- setup (service role / admin) ---
    const a = await admin.auth.admin.createUser({ email: emailA, password: "Pw-A-1!", email_confirm: true });
    const b = await admin.auth.admin.createUser({ email: emailB, password: "Pw-B-1!", email_confirm: true });
    if (a.error || b.error) throw a.error ?? b.error;
    userA = a.data.user.id;
    userB = b.data.user.id;

    const wsA = await admin.from("workspaces").insert({ name: "WS-A", owner_id: userA }).select("id").single();
    const wsB = await admin.from("workspaces").insert({ name: "WS-B", owner_id: userB }).select("id").single();
    if (wsA.error || wsB.error) throw wsA.error ?? wsB.error;
    const workspaceA = wsA.data.id as string;
    const workspaceB = wsB.data.id as string;

    const mA = await admin.from("memberships").insert({ workspace_id: workspaceA, user_id: userA, role: "owner" });
    const mB = await admin.from("memberships").insert({ workspace_id: workspaceB, user_id: userB, role: "owner" });
    if (mA.error || mB.error) throw mA.error ?? mB.error;

    const lA = await admin.from("leads").insert({ workspace_id: workspaceA, linkedin_url: "https://linkedin.com/in/a" });
    const lB = await admin.from("leads").insert({ workspace_id: workspaceB, linkedin_url: "https://linkedin.com/in/b" });
    if (lA.error || lB.error) throw lA.error ?? lB.error;

    // --- RLS assertions ---
    const aSeesOwn = await asUser<{ count: number }>(pg, userA, COUNT_LEADS, [workspaceA]);
    check("User A reads own workspace leads", aSeesOwn[0].count === 1, `count=${aSeesOwn[0].count} (expected 1)`);

    const aSeesOther = await asUser<{ count: number }>(pg, userA, COUNT_LEADS, [workspaceB]);
    check("User A CANNOT read workspace B leads", aSeesOther[0].count === 0, `count=${aSeesOther[0].count} (expected 0)`);

    const aWorkspaces = await asUser<{ id: string }>(pg, userA, "select id from public.workspaces");
    const ids = aWorkspaces.map((r) => r.id);
    check(
      "User A sees only their workspace",
      ids.includes(workspaceA) && !ids.includes(workspaceB),
      `visible=[${ids.join(", ")}]`,
    );

    const svcSeesB = await asServiceRole<{ count: number }>(pg, COUNT_LEADS, [workspaceB]);
    check("Service role bypasses RLS (reads workspace B)", svcSeesB[0].count === 1, `count=${svcSeesB[0].count} (expected 1)`);
  } finally {
    // --- cleanup (cascades remove workspaces/leads/memberships) ---
    if (userA) await admin.auth.admin.deleteUser(userA);
    if (userB) await admin.auth.admin.deleteUser(userB);
    await pg.end();
  }

  console.log("\nRLS test results:");
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}  — ${r.detail}`);
  }
  const allPass = results.every((r) => r.pass);
  console.log(`\n${allPass ? "ALL PASSED" : "SOME FAILED"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("RLS test errored:", error instanceof Error ? error.message : error);
  process.exit(1);
});
