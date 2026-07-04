// AUDIT TOOLING (throwaway): clean reply-spine E2E with FRESH untouched leads
// (L6 full_auto auto-send, L7 approve_all draft+approve) and correct engine
// action type names (connection_request/message). Simulated workspace.
// Usage: pnpm --filter @10xconnect/db exec tsx scripts/_audit-reply.ts

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
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function q(sql: string, p: unknown[] = []) { return (await pg.query(sql, p)).rows; }
async function pollUntil(label: string, sql: string, p: unknown[], pred: (r: any[]) => boolean, timeoutMs = 60000) {
  const start = Date.now(); let rows: any[] = [];
  while (Date.now() - start < timeoutMs) { rows = await q(sql, p); if (pred(rows)) return { ok: true, rows }; await sleep(2000); }
  say(`  ⚠ TIMEOUT: ${label} last=${JSON.stringify(rows).slice(0, 160)}`);
  return { ok: false, rows };
}

async function main(): Promise<void> {
  await pg.connect();
  const ws = ctx.workspaceId;

  // ===== C1b: full_auto auto-send, FRESH lead L6, skip_already_contacted=false
  say("=== C1b: full_auto reply auto-stop + AI auto-send (L6) ===");
  const c1 = (await api("POST", "/campaigns", { name: "C1b Reply", accountId: ctx.accountId, aiReplyMode: "full_auto" })).json.id;
  await api("PATCH", `/campaigns/${c1}`, { settings: { skip_already_contacted: false } });
  const kb = (await api("POST", "/knowledge-bases", { name: "C1b KB" })).json.id;
  await api("POST", `/knowledge-bases/${kb}/ingest`, { text: "10xConnect is an AI outreach copilot for B2B sales teams. It personalizes LinkedIn and email sequences, auto-replies to prospects, and books meetings. Free 14-day trial.", source: "offer" });
  await api("PUT", `/campaigns/${c1}/brain`, { objective: { goal: "book demos", offer: "AI outreach copilot" }, voice: { tone: "warm, concise" }, autonomy: { mode: "full_auto", confidence_threshold: 0.2 }, knowledgeBaseId: kb });
  await api("PUT", `/campaigns/${c1}/sequence`, { nodes: [
    { id: "n1", kind: "action", type: "send_connection_request", config: {}, next: "n2" },
    { id: "n2", kind: "condition", type: "invite_accepted", config: { waitDays: 2 }, true: "n3", false: "n5" },
    { id: "n3", kind: "action", type: "send_message", config: { messageBody: { v: 1, segments: [{ type: "text", text: "Hi " }, { type: "variable", key: "first_name", fallback: "there" }, { type: "text", text: ", thanks for connecting!" }] } }, next: "n4" },
    { id: "n4", kind: "condition", type: "message_replied", config: { waitDays: 2 }, true: "n6", false: "n7" },
    { id: "n5", kind: "action", type: "visit_profile", config: {}, next: null },
    { id: "n6", kind: "action", type: "add_tag", config: { tag: "replied-yes" }, next: null },
    { id: "n7", kind: "action", type: "comment_last_post", config: {}, next: null },
  ] });
  say(`  enroll L6: ${JSON.stringify((await api("POST", `/campaigns/${c1}/leads`, { leadIds: [ctx.leadIds.L6] })).json)}`);
  say(`  start: ${JSON.stringify((await api("POST", `/campaigns/${c1}/start`, {})).json)}`);

  let p = await pollUntil("L6 connection_request success", `select status from public.actions where campaign_id=$1 and lead_id=$2 and type='connection_request' and status='success'`, [c1, ctx.leadIds.L6], (r) => r.length > 0, 40000);
  say(`  connection_request success: ${p.ok}`);

  say("  → simulate invite_accepted(L6)");
  await api("POST", "/dev/simulate", { type: "invite_accepted", leadId: ctx.leadIds.L6 });
  p = await pollUntil("L6 message success", `select status from public.actions where campaign_id=$1 and lead_id=$2 and type='message' and status='success'`, [c1, ctx.leadIds.L6], (r) => r.length > 0, 45000);
  say(`  invite→true branch → message sent: ${p.ok}`);

  say("  → simulate reply(L6) with an EASY question (should full_auto AUTO-SEND)");
  await api("POST", "/dev/simulate", { type: "reply", leadId: ctx.leadIds.L6, body: "Oh interesting, what does it actually do?" });
  const rep = await pollUntil("L6 state=replied", `select status from public.lead_campaign_state where campaign_id=$1 and lead_id=$2`, [c1, ctx.leadIds.L6], (r) => r[0]?.status === "replied", 25000);
  say(`  L6 lead_campaign_state: ${JSON.stringify(rep.rows)} (expect replied)`);
  const pend = await q(`select count(*)::int n from public.actions where campaign_id=$1 and lead_id=$2 and status='pending'`, [c1, ctx.leadIds.L6]);
  say(`  L6 pending actions after reply: ${pend[0].n} (expect 0 — auto-stop skips them)`);
  const convo = await q(`select cv.id, cv.needs_attention, (select count(*) from public.messages m where m.conversation_id=cv.id and m.direction='inbound')::int inbound from public.conversations cv where cv.workspace_id=$1 and cv.lead_id=$2`, [ws, ctx.leadIds.L6]);
  say(`  conversation: ${JSON.stringify(convo)}`);
  const ai = await pollUntil("L6 AI outbound", `select m.authored_by from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L6], (r) => r.length > 0, 60000);
  const thread = await q(`select m.direction, m.authored_by, left(m.body,110) body from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 order by m.created_at`, [ws, ctx.leadIds.L6]);
  say(`  FULL THREAD:`); for (const t of thread) say(`    [${t.direction}/${t.authored_by}] ${t.body}`);
  const turn = await q(`select type, status, result->>'reason' reason, result->>'status' rstatus from public.actions where workspace_id=$1 and lead_id=$2 and type='conversation_turn'`, [ws, ctx.leadIds.L6]);
  say(`  conversation_turn: ${JSON.stringify(turn)}`);

  // ===== C4b: approve_all, FRESH lead L7, non-escalating reply → plain draft → approve
  say("\n=== C4b: approve_all draft → approve (L7) ===");
  const c4 = (await api("POST", "/campaigns", { name: "C4b ApproveAll", accountId: ctx.accountId, aiReplyMode: "approve_all" })).json.id;
  await api("PATCH", `/campaigns/${c4}`, { settings: { skip_already_contacted: false } });
  const kb4 = (await api("POST", "/knowledge-bases", { name: "C4b KB" })).json.id;
  await api("POST", `/knowledge-bases/${kb4}/ingest`, { text: "10xConnect is an AI outreach copilot. It automates LinkedIn outreach and books meetings. 14-day free trial.", source: "offer" });
  await api("PUT", `/campaigns/${c4}/brain`, { objective: { goal: "book demos" }, autonomy: { mode: "approve_all" }, knowledgeBaseId: kb4 });
  await api("PUT", `/campaigns/${c4}/sequence`, { nodes: [{ id: "m", kind: "action", type: "send_message", config: { messageBody: { v: 1, segments: [{ type: "text", text: "Hello!" }] } }, next: null }] });
  await api("POST", `/campaigns/${c4}/leads`, { leadIds: [ctx.leadIds.L7] });
  say(`  start: ${JSON.stringify((await api("POST", `/campaigns/${c4}/start`, {})).json)}`);
  p = await pollUntil("L7 message success", `select status from public.actions where campaign_id=$1 and lead_id=$2 and type='message' and status='success'`, [c4, ctx.leadIds.L7], (r) => r.length > 0, 40000);
  say(`  message sent: ${p.ok}`);
  say("  → simulate reply(L7) EASY question (approve_all → DRAFT, no auto-send)");
  await api("POST", "/dev/simulate", { type: "reply", leadId: ctx.leadIds.L7, body: "sounds interesting, what is it exactly?" });
  const draft = await pollUntil("L7 draft", `select d.status from public.message_drafts d join public.conversations cv on cv.id=d.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2`, [ws, ctx.leadIds.L7], (r) => r.length > 0, 45000);
  say(`  draft: ${JSON.stringify(draft.rows)} (expect status pending/ready, not auto-sent)`);
  const pre = await q(`select count(*)::int n from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L7]);
  say(`  outbound before approve: ${pre[0].n} (expect 0)`);
  const conv7 = await q(`select id from public.conversations where workspace_id=$1 and lead_id=$2`, [ws, ctx.leadIds.L7]);
  if (conv7[0]) {
    const ap = await api("POST", `/conversations/${conv7[0].id}/draft/approve`, {});
    say(`  approve: ${ap.status} ${JSON.stringify(ap.json).slice(0, 100)}`);
    const post = await pollUntil("L7 outbound after approve", `select m.authored_by from public.messages m join public.conversations cv on cv.id=m.conversation_id where cv.workspace_id=$1 and cv.lead_id=$2 and m.direction='outbound'`, [ws, ctx.leadIds.L7], (r) => r.length > 0, 30000);
    say(`  outbound after approve: ${JSON.stringify(post.rows)} (expect 1, authored_by human)`);
  }

  // ===== corrected A1 (transport actions only)
  const a1 = await q(`select count(*)::int n from public.actions where workspace_id=$1 and status='success'
    and type in ('connection_request','message','voice_note','inmail','open_profile_message','comment_post','like_post','visit_profile','follow_lead','conversation_reply')
    and (result->>'providerRef') is distinct from 'SIMULATED'`, [ws]);
  say(`\n=== A1 (transport sends only): non-SIMULATED = ${a1[0].n} (MUST be 0) ===`);
  say("REPLY_SPINE_DONE");
  await pg.end();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.stack : e); try { await pg.end(); } catch {} process.exit(1); });
