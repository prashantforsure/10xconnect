// AUDIT TOOLING (throwaway): (1) diagnose L6's leftover pending action after
// auto-stop, (2) suppression-at-dispatch probe (#3), (3) restriction event (#8,
// LAST — mutates the shared account, then resets it). Simulated workspace.
import { readFileSync } from "node:fs";
import { createPgClient } from "./db-utils";

const SCRATCH =
  "C:/Users/PRASHA~1/AppData/Local/Temp/claude/c--Users-Prashant-Patel-OneDrive-Desktop-code-2026-10xconnect-main-10xconnect-codebase/efa6ebbf-ea56-4bff-af55-50be192f3283/scratchpad";
const ctx = JSON.parse(readFileSync(`${SCRATCH}/audit-context.json`, "utf8"));
const token = readFileSync(`${SCRATCH}/audit-token.txt`, "utf8").trim();
const BASE = "http://localhost:3001/api/v1";
const H = { Authorization: `Bearer ${token}`, "X-Workspace-Id": ctx.workspaceId, "Content-Type": "application/json" };
const pg = createPgClient();
const say = (m: string) => console.log(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let j: any = null; try { j = JSON.parse(t); } catch {} return { status: res.status, json: j, text: t };
}
async function q(sql: string, p: unknown[] = []) { return (await pg.query(sql, p)).rows; }
async function pollUntil(label: string, sql: string, p: unknown[], pred: (r: any[]) => boolean, ms = 40000) {
  const s = Date.now(); let rows: any[] = [];
  while (Date.now() - s < ms) { rows = await q(sql, p); if (pred(rows)) return { ok: true, rows }; await sleep(2000); }
  say(`  ⚠ TIMEOUT ${label}`); return { ok: false, rows };
}

async function main(): Promise<void> {
  await pg.connect();
  const ws = ctx.workspaceId;

  // (1) L6 leftover pending action — what is it, would it ever send?
  say("=== (1) L6 leftover pending action after auto-stop ===");
  const l6pending = await q(`
    select a.id, a.type, a.status, a.scheduled_at, a.node_id, n.kind, n.type node_type
    from public.actions a left join public.sequence_nodes n on n.id = a.node_id
    where a.lead_id=$1 and a.status='pending'`, [ctx.leadIds.L6]);
  say(`  L6 pending: ${JSON.stringify(l6pending)}`);
  const l6state = await q(`select status from public.lead_campaign_state where lead_id=$1`, [ctx.leadIds.L6]);
  say(`  L6 state: ${JSON.stringify(l6state)} → dispatch skips non-active leads, so this ${l6pending[0]?.kind === 'condition' ? 'CONDITION' : l6pending[0]?.node_type} action will be skipped on fire (no send). Verifying by waiting for it to fire...`);
  if (l6pending[0]) {
    // nudge: set scheduled_at to now so it fires this tick
    await q(`update public.actions set scheduled_at = now() where id=$1`, [l6pending[0].id]).catch(() => {});
    const after = await pollUntil("L6 pending resolves", `select status from public.actions where lead_id=$1 and node_id=$2`, [ctx.leadIds.L6, l6pending[0].node_id], (r) => r.some((x) => x.status !== "pending"), 20000);
    const final = await q(`select a.type, a.status, a.result->>'providerRef' ref from public.actions a where a.lead_id=$1 and a.node_id=$2`, [ctx.leadIds.L6, l6pending[0].node_id]);
    say(`  after fire: ${JSON.stringify(final)} (skipped/no-send = benign; success+SIMULATED on a transport type = leak-past-autostop)`);
  }

  // (2) suppression enforced at dispatch — enroll L9(email-only, untouched) then add DNC BEFORE start
  say("\n=== (2) suppression enforced at dispatch (#3) ===");
  const cs = (await api("POST", "/campaigns", { name: "P-suppress", accountId: ctx.accountId, aiReplyMode: "approve_all" })).json.id;
  await api("PATCH", `/campaigns/${cs}`, { settings: { skip_already_contacted: false } });
  await api("PUT", `/campaigns/${cs}/sequence`, { nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  // use L4 (has linkedin_url, untouched by campaigns other than C1... L4 was in C1). Use a truly fresh: L8 sparse has url audit-sim-lead-8
  const supLead = ctx.leadIds.L8;
  const supUrl = "https://www.linkedin.com/in/audit-sim-lead-8";
  say(`  enroll L8: ${JSON.stringify((await api("POST", `/campaigns/${cs}/leads`, { leadIds: [supLead] })).json)}`);
  // add to do_not_contact BEFORE starting → dispatch must skip
  await q(`insert into public.do_not_contact (workspace_id, linkedin_url, reason) values ($1,$2,'audit #3 probe') on conflict do nothing`, [ws, supUrl]);
  say(`  added L8 to do_not_contact, now start`);
  say(`  start: ${JSON.stringify((await api("POST", `/campaigns/${cs}/start`, {})).json)}`);
  const sup = await pollUntil("L8 action resolves", `select status, result->>'providerRef' ref from public.actions where campaign_id=$1 and lead_id=$2`, [cs, supLead], (r) => r.length > 0 && r[0].status !== "pending" && r[0].status !== "executing", 30000);
  const supRows = await q(`select type, status, result->>'providerRef' ref from public.actions where campaign_id=$1 and lead_id=$2`, [cs, supLead]);
  const supState = await q(`select status from public.lead_campaign_state where campaign_id=$1 and lead_id=$2`, [cs, supLead]);
  const sent = supRows.some((r) => r.status === "success" && r.ref === "SIMULATED");
  say(`  L8 action: ${JSON.stringify(supRows)} state=${JSON.stringify(supState)}`);
  say(`  RESULT: ${sent ? "❌ SENT despite DNC (confirms #3 bug)" : "✓ suppressed at dispatch (no send)"}`);

  // (3) restriction — LAST. simulate restriction, assert account + held campaign actions, then RESET
  say("\n=== (3) restriction event (#8) — mutates account, resets after ===");
  const before = await q(`select status, health_score from public.sending_accounts where id=$1`, [ctx.accountId]);
  say(`  account before: ${JSON.stringify(before)}`);
  const rr = await api("POST", "/dev/simulate", { type: "restriction" });
  say(`  dev/simulate restriction: ${rr.status} ${JSON.stringify(rr.json)}`);
  const after = await pollUntil("account restricted", `select status, health_score from public.sending_accounts where id=$1`, [ctx.accountId], (r) => r[0]?.status === "restricted", 15000);
  say(`  account after: ${JSON.stringify(after.rows)} (expect restricted, low health)`);
  const notif = await q(`select type, title from public.notifications where workspace_id=$1 order by created_at desc limit 3`, [ws]).catch(() => []);
  say(`  notifications: ${JSON.stringify(notif)}`);
  // reset the account so the workspace stays usable for the user's manual UI pass
  await q(`update public.sending_accounts set status='active', health_score=100 where id=$1`, [ctx.accountId]);
  say(`  ✓ account reset to active/100 for manual UI review`);

  const a1 = await q(`select count(*)::int n from public.actions where workspace_id=$1 and status='success'
    and type in ('connection_request','message','voice_note','inmail','open_profile_message','comment_post','like_post','visit_profile','follow_lead','conversation_reply')
    and (result->>'providerRef') is distinct from 'SIMULATED'`, [ws]);
  say(`\n=== A1 (transport only) non-SIMULATED = ${a1[0].n} (MUST be 0) ===`);
  say("PROBES_DONE");
  await pg.end();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.stack : e); try { await pg.end(); } catch {} process.exit(1); });
