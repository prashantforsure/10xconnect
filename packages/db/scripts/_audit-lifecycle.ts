// AUDIT TOOLING (throwaway — never commit): drives the B6 run-lifecycle E2E for
// the /campaigns/:id audit — C1 full_auto branching campaign + reply auto-stop +
// AI turn, C4 approve_all draft path, and pause/resume. All simulated (sim
// workspace); polls the DB directly to observe async dispatch. Prints a timeline.
// Usage: pnpm --filter @10xconnect/db exec tsx scripts/_audit-lifecycle.ts

import { readFileSync } from "node:fs";

import { createPgClient } from "./db-utils";

const SCRATCH =
  "C:/Users/PRASHA~1/AppData/Local/Temp/claude/c--Users-Prashant-Patel-OneDrive-Desktop-code-2026-10xconnect-main-10xconnect-codebase/efa6ebbf-ea56-4bff-af55-50be192f3283/scratchpad";
const ctx = JSON.parse(readFileSync(`${SCRATCH}/audit-context.json`, "utf8"));
const token = readFileSync(`${SCRATCH}/audit-token.txt`, "utf8").trim();
const BASE = "http://localhost:3001/api/v1";
const H = { Authorization: `Bearer ${token}`, "X-Workspace-Id": ctx.workspaceId, "Content-Type": "application/json" };
const pg = createPgClient();

const log: string[] = [];
const say = (m: string) => { log.push(m); console.log(m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
async function q(sql: string, params: unknown[] = []) { return (await pg.query(sql, params)).rows; }

/** Poll until predicate(rows) truthy or timeout; returns last rows. */
async function pollUntil(label: string, sql: string, params: unknown[], pred: (rows: any[]) => boolean, timeoutMs = 60000) {
  const start = Date.now();
  let rows: any[] = [];
  while (Date.now() - start < timeoutMs) {
    rows = await q(sql, params);
    if (pred(rows)) return rows;
    await sleep(2000);
  }
  say(`  ⚠ TIMEOUT waiting for: ${label} (last=${JSON.stringify(rows).slice(0, 200)})`);
  return rows;
}

async function main(): Promise<void> {
  await pg.connect();
  const ws = ctx.workspaceId;

  // ============================================================ C1 setup
  say("=== C1: full_auto branching campaign ===");
  let r = await api("POST", "/campaigns", { name: "C1 Lifecycle", accountId: ctx.accountId, aiReplyMode: "full_auto" });
  const c1 = r.json.id;
  const kb = (await api("POST", "/knowledge-bases", { name: "C1 KB" })).json.id;
  await api("POST", `/knowledge-bases/${kb}/ingest`, { text: "10xConnect: AI outreach copilot. Starter $49/mo, Pro $149/mo. Integrates HubSpot. 14-day free trial. Founded 2024 Berlin.", source: "offer" });
  await api("PUT", `/campaigns/${c1}/brain`, {
    objective: { goal: "book demos", offer: "AI outreach copilot", cta: "15-min call" },
    voice: { tone: "warm, concise" },
    autonomy: { mode: "full_auto", confidence_threshold: 0.3 },
    knowledgeBaseId: kb,
  });
  const graph = [
    { id: "n1", kind: "action", type: "like_last_post", config: {}, next: "n2" },
    { id: "n2", kind: "action", type: "send_connection_request", config: {}, next: "n3" },
    { id: "n3", kind: "condition", type: "invite_accepted", config: { waitDays: 2 }, true: "n4", false: "n7" },
    { id: "n4", kind: "action", type: "send_message", config: { messageBody: { v: 1, segments: [{ type: "text", text: "Hi " }, { type: "variable", key: "first_name", fallback: "there" }, { type: "text", text: ", thanks for connecting!" }] } }, next: "n5" },
    { id: "n5", kind: "action", type: "wait_x_days", config: {}, delayDays: 0, next: "n6" },
    { id: "n6", kind: "condition", type: "message_replied", config: { waitDays: 2 }, true: "n8", false: "n9" },
    { id: "n7", kind: "action", type: "visit_profile", config: {}, next: null },
    { id: "n8", kind: "action", type: "add_tag", config: { tag: "replied-yes" }, next: null },
    { id: "n9", kind: "action", type: "comment_last_post", config: {}, next: null },
  ];
  r = await api("PUT", `/campaigns/${c1}/sequence`, { nodes: graph });
  say(`  sequence saved: ${r.status}`);
  // map client ids -> uuid node ids
  const nodes = await q(`select id, type from public.sequence_nodes where campaign_id = $1`, [c1]);
  const nodeByType = (t: string) => nodes.find((n) => n.type === t)?.id;

  r = await api("POST", `/campaigns/${c1}/leads`, { leadIds: [ctx.leadIds.L1, ctx.leadIds.L2, ctx.leadIds.L3, ctx.leadIds.L4] });
  say(`  enrolled: ${JSON.stringify(r.json)}`);
  r = await api("POST", `/campaigns/${c1}/start`, {});
  say(`  start: ${JSON.stringify(r.json)}`);

  // ---- observe dispatch: L1 connection_request should succeed (SIMULATED)
  await pollUntil("L1 connreq success", `
    select a.type, a.status, a.result->>'providerRef' ref from public.actions a
    where a.campaign_id = $1 and a.lead_id = $2 and a.type in ('send_connection_request','connection_request') and a.status='success'`,
    [c1, ctx.leadIds.L1], (rows) => rows.length > 0);
  say("  ✓ L1 connection_request dispatched (SIMULATED)");

  // ---- simulate invite accepted for L1 → true branch → send_message
  say("--- simulate invite_accepted(L1) → expect true branch (send_message) ---");
  r = await api("POST", "/dev/simulate", { type: "invite_accepted", leadId: ctx.leadIds.L1 });
  say(`  dev/simulate invite_accepted: ${r.status} ${JSON.stringify(r.json)}`);
  await pollUntil("L1 send_message success", `
    select a.status from public.actions a
    where a.campaign_id=$1 and a.lead_id=$2 and a.type='send_message' and a.status='success'`,
    [c1, ctx.leadIds.L1], (rows) => rows.length > 0, 45000);
  const l1msg = await q(`select a.type,a.status from public.actions a where a.campaign_id=$1 and a.lead_id=$2 and a.type='send_message'`, [c1, ctx.leadIds.L1]);
  say(`  ✓ L1 invite→true branch: send_message = ${JSON.stringify(l1msg)}`);

  // ---- verify L2 (no invite) is HELD at invite_accepted condition
  const l2state = await q(`select s.status, n.type node from public.lead_campaign_state s left join public.sequence_nodes n on n.id=s.current_node_id where s.campaign_id=$1 and s.lead_id=$2`, [c1, ctx.leadIds.L2]);
  say(`  L2 (no invite) parked at: ${JSON.stringify(l2state)} (expect invite_accepted, active/waiting)`);

  // ---- simulate REPLY for L1 → auto-stop + conversation + AI turn (full_auto)
  say("--- simulate reply(L1) → expect auto-stop + inbox + AI turn auto-send ---");
  r = await api("POST", "/dev/simulate", { type: "reply", leadId: ctx.leadIds.L1, body: "Interesting — how much does it cost?" });
  say(`  dev/simulate reply: ${r.status} ${JSON.stringify(r.json)}`);
  // lead auto-stopped
  await pollUntil("L1 state replied", `select status from public.lead_campaign_state where campaign_id=$1 and lead_id=$2`, [c1, ctx.leadIds.L1], (rows) => rows[0]?.status === "replied", 30000);
  const l1final = await q(`select status from public.lead_campaign_state where campaign_id=$1 and lead_id=$2`, [c1, ctx.leadIds.L1]);
  say(`  L1 lead state: ${JSON.stringify(l1final)} (expect replied)`);
  // pending actions for L1 skipped
  const l1pending = await q(`select count(*)::int n from public.actions where campaign_id=$1 and lead_id=$2 and status='pending'`, [c1, ctx.leadIds.L1]);
  say(`  L1 pending actions after reply: ${l1pending[0].n} (expect 0)`);
  // conversation + inbound message
  const convo = await q(`select cv.id, cv.needs_attention, (select count(*) from public.messages m where m.conversation_id=cv.id and m.direction='inbound')::int inbound from public.conversations cv where cv.workspace_id=$1 and cv.lead_id=$2`, [ws, ctx.leadIds.L1]);
  say(`  conversation: ${JSON.stringify(convo)} (expect 1 row, inbound>=1, needs_attention)`);
  // AI turn enqueued + executed → outbound ai message
  await pollUntil("L1 AI outbound message", `
    select m.direction, m.authored_by, m.result_ref from (
      select m.direction, m.authored_by, null result_ref from public.messages m
      join public.conversations cv on cv.id=m.conversation_id
      where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound') m`,
    [ws, ctx.leadIds.L1], (rows) => rows.length > 0, 60000);
  const aiMsgs = await q(`select m.direction, m.authored_by, left(m.body,90) body from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 order by m.created_at`, [ws, ctx.leadIds.L1]);
  say(`  thread messages: ${JSON.stringify(aiMsgs)}`);
  const turnActions = await q(`select type, status, result->>'providerRef' ref from public.actions where workspace_id=$1 and type in ('conversation_turn','conversation_reply') order by created_at`, [ws]);
  say(`  turn/reply actions: ${JSON.stringify(turnActions)}`);

  // ============================================================ C4 approve_all
  say("\n=== C4: approve_all draft path ===");
  r = await api("POST", "/campaigns", { name: "C4 ApproveAll", accountId: ctx.accountId, aiReplyMode: "approve_all" });
  const c4 = r.json.id;
  const kb4 = (await api("POST", "/knowledge-bases", { name: "C4 KB" })).json.id;
  await api("POST", `/knowledge-bases/${kb4}/ingest`, { text: "10xConnect pricing: Starter $49, Pro $149. Free trial 14 days.", source: "offer" });
  await api("PUT", `/campaigns/${c4}/brain`, { objective: { goal: "book demos" }, autonomy: { mode: "approve_all" }, knowledgeBaseId: kb4 });
  await api("PUT", `/campaigns/${c4}/sequence`, { nodes: [{ id: "m", kind: "action", type: "send_message", config: { messageBody: { v: 1, segments: [{ type: "text", text: "Hello!" }] } }, next: null }] });
  await api("POST", `/campaigns/${c4}/leads`, { leadIds: [ctx.leadIds.L5] });
  r = await api("POST", `/campaigns/${c4}/start`, {});
  say(`  C4 start: ${JSON.stringify(r.json)}`);
  await pollUntil("C4 L5 send_message", `select status from public.actions where campaign_id=$1 and lead_id=$2 and type='send_message' and status='success'`, [c4, ctx.leadIds.L5], (rows) => rows.length > 0, 40000);
  r = await api("POST", "/dev/simulate", { type: "reply", leadId: ctx.leadIds.L5, body: "Tell me more about pricing" });
  say(`  reply(L5): ${r.status}`);
  // expect a DRAFT, no auto-send
  await pollUntil("C4 draft created", `select d.status from public.message_drafts d join public.conversations cv on cv.id=d.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2`, [ws, ctx.leadIds.L5], (rows) => rows.length > 0, 45000).catch(() => []);
  const c4draft = await q(`select d.id, d.status, left(d.body,80) body from public.message_drafts d join public.conversations cv on cv.id=d.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2`, [ws, ctx.leadIds.L5]).catch(() => []);
  const c4outbound = await q(`select count(*)::int n from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L5]);
  say(`  C4 draft: ${JSON.stringify(c4draft)}`);
  say(`  C4 outbound msgs before approve: ${c4outbound[0].n} (expect 0 — approve_all does NOT auto-send)`);
  // approve the draft
  const c4conv = await q(`select id from public.conversations where workspace_id=$1 and lead_id=$2`, [ws, ctx.leadIds.L5]);
  if (c4conv[0] && c4draft[0]) {
    r = await api("POST", `/conversations/${c4conv[0].id}/draft/approve`, {});
    say(`  approve draft: ${r.status} ${JSON.stringify(r.json).slice(0,120)}`);
    await pollUntil("C4 outbound after approve", `select count(*)::int n from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L5], (rows) => rows[0]?.n > 0, 30000);
    const after = await q(`select m.authored_by, m.result->>'providerRef' ref from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L5]).catch(() => q(`select m.authored_by from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L5]));
    say(`  C4 outbound after approve: ${JSON.stringify(after)} (expect authored_by human/ai, SIMULATED)`);
  }

  // ============================================================ pause / resume on C1 (L3,L4 still active)
  say("\n=== pause/resume on C1 (issue #1 probe) ===");
  const beforePause = await q(`select lead_id, status, current_node_id from public.lead_campaign_state where campaign_id=$1 and status='active'`, [c1]);
  say(`  C1 active leads before pause: ${beforePause.length}`);
  r = await api("POST", `/campaigns/${c1}/pause`, {});
  say(`  pause: ${r.status} ${JSON.stringify(r.json).slice(0,120)}`);
  const pausedStatus = await q(`select status from public.campaigns where id=$1`, [c1]);
  const heldOrSkipped = await q(`select status, count(*)::int n from public.actions where campaign_id=$1 group by status`, [c1]);
  say(`  campaign status: ${pausedStatus[0].status}; actions by status: ${JSON.stringify(heldOrSkipped)}`);
  // double-pause
  r = await api("POST", `/campaigns/${c1}/pause`, {});
  say(`  double-pause: ${r.status} (expect 400) ${JSON.stringify(r.json).slice(0,80)}`);
  // resume
  r = await api("POST", `/campaigns/${c1}/resume`, {});
  say(`  resume: ${r.status} ${JSON.stringify(r.json).slice(0,120)}`);
  const afterResume = await q(`select lead_id, count(*)::int pending from public.actions where campaign_id=$1 and status='pending' group by lead_id`, [c1]);
  say(`  pending actions per lead after resume: ${JSON.stringify(afterResume)} (expect exactly 1 per active lead — issue #1)`);

  // ============================================================ A1 safety assertion
  const a1 = await q(`select count(*)::int n from public.actions where workspace_id=$1 and status='success' and (result->>'providerRef') is distinct from 'SIMULATED'`, [ws]);
  say(`\n=== A1 SAFETY: real (non-SIMULATED) successful sends = ${a1[0].n} (MUST be 0) ===`);

  say("\nLIFECYCLE_DONE");
  await pg.end();
}

main().catch(async (e: unknown) => {
  console.error("lifecycle failed:", e instanceof Error ? e.stack ?? e.message : e);
  try { await pg.end(); } catch { /* */ }
  process.exit(1);
});
