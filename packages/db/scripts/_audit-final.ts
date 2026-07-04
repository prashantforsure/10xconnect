// AUDIT TOOLING (throwaway): verify save-as-template POST + final A1 sweep + tally.
import { readFileSync } from "node:fs";
import { createPgClient } from "./db-utils";
const SCRATCH = "C:/Users/PRASHA~1/AppData/Local/Temp/claude/c--Users-Prashant-Patel-OneDrive-Desktop-code-2026-10xconnect-main-10xconnect-codebase/efa6ebbf-ea56-4bff-af55-50be192f3283/scratchpad";
const ctx = JSON.parse(readFileSync(`${SCRATCH}/audit-context.json`, "utf8"));
const token = readFileSync(`${SCRATCH}/audit-token.txt`, "utf8").trim();
const BASE = "http://localhost:3001/api/v1";
const H = { Authorization: `Bearer ${token}`, "X-Workspace-Id": ctx.workspaceId, "Content-Type": "application/json" };
const pg = createPgClient();
async function api(m: string, p: string, b?: unknown) { const r = await fetch(`${BASE}${p}`, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t }; }
async function main(): Promise<void> {
  await pg.connect();
  const ws = ctx.workspaceId;
  // save-as-template POST — discover DTO from a probe
  const cid = (await api("POST", "/campaigns", { name: "T-src" })).json.id;
  await api("PUT", `/campaigns/${cid}/sequence`, { nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  // try likely shapes
  let r = await api("POST", "/workflow-templates", { name: "Audit tmpl", campaignId: cid, scope: "workspace" });
  console.log(`POST /workflow-templates {name,campaignId,scope}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  if (r.status >= 400) { r = await api("POST", "/workflow-templates", { name: "Audit tmpl", sourceCampaignId: cid }); console.log(`  retry {name,sourceCampaignId}: ${r.status} ${JSON.stringify(r.json).slice(0,160)}`); }
  const list = await api("GET", "/workflow-templates?scope=mine");
  console.log(`GET /workflow-templates?scope=mine: ${list.status} count=${Array.isArray(list.json) ? list.json.length : "?"}`);

  // final A1 sweep (transport only)
  const a1 = (await pg.query(`select count(*)::int n from public.actions where workspace_id=$1 and status='success' and type in ('connection_request','message','voice_note','inmail','open_profile_message','comment_post','like_post','visit_profile','follow_lead','conversation_reply') and (result->>'providerRef') is distinct from 'SIMULATED'`, [ws])).rows[0].n;
  const totals = (await pg.query(`select count(*)::int actions, count(*) filter (where status='success')::int success, count(*) filter (where result->>'providerRef'='SIMULATED')::int simulated from public.actions where workspace_id=$1`, [ws])).rows[0];
  const camps = (await pg.query(`select count(*)::int n from public.campaigns where workspace_id=$1`, [ws])).rows[0].n;
  const convos = (await pg.query(`select count(*)::int n from public.conversations where workspace_id=$1`, [ws])).rows[0].n;
  console.log(`\nFINAL A1 (transport non-SIMULATED sends): ${a1}  [MUST be 0]`);
  console.log(`Totals: campaigns=${camps} actions=${totals.actions} success=${totals.success} simulated=${totals.simulated} conversations=${convos}`);
  await pg.end();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); try { await pg.end(); } catch {} process.exit(1); });
