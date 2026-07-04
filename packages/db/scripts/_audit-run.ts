// AUDIT TOOLING (throwaway — never commit): request/response feature tests for
// the /campaigns/:id audit (B1 CRUD/settings, B2 sequence validation, B3
// composer/AI, B4 brain/KB, B7 aux). Records structured evidence to stdout JSON.
// Usage: pnpm --filter @10xconnect/db exec tsx scripts/_audit-run.ts <group>
//   group ∈ all | b1 | b2 | b3 | b4 | b7
// Reads context + token from the scratchpad files (paths below).

import { readFileSync } from "node:fs";

const SCRATCH =
  "C:/Users/PRASHA~1/AppData/Local/Temp/claude/c--Users-Prashant-Patel-OneDrive-Desktop-code-2026-10xconnect-main-10xconnect-codebase/efa6ebbf-ea56-4bff-af55-50be192f3283/scratchpad";
const ctx = JSON.parse(readFileSync(`${SCRATCH}/audit-context.json`, "utf8"));
const token = readFileSync(`${SCRATCH}/audit-token.txt`, "utf8").trim();
const BASE = "http://localhost:3001/api/v1";
const H = {
  Authorization: `Bearer ${token}`,
  "X-Workspace-Id": ctx.workspaceId,
  "Content-Type": "application/json",
};

const group = (process.argv[2] ?? "all").toLowerCase();
const results: Array<Record<string, unknown>> = [];

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json (e.g. html) */
  }
  return { status: res.status, json, text };
}

function rec(
  id: string,
  name: string,
  pass: boolean,
  expected: string,
  observed: string,
  extra: Partial<{ bug: boolean; severity: string; notes: string }> = {},
): void {
  results.push({ id, name, pass, expected, observed, ...extra });
}

const errMsg = (r: { json: any; text: string }): string => {
  const e = r.json?.error ?? r.json?.message ?? r.json;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") return JSON.stringify(e).slice(0, 300);
  return r.text.slice(0, 200);
};

// ---------------------------------------------------------------- B1 CRUD
async function b1(): Promise<void> {
  // 1 create basic
  let r = await api("POST", "/campaigns", { name: "B1-basic" });
  const basicId = r.json?.id;
  rec("1", "create draft", r.status < 300 && r.json?.status === "draft", "201 draft", `${r.status} status=${r.json?.status}`);
  // defaults present
  const freq = await api("GET", `/campaigns/${basicId}/settings/frequency`);
  const sched = await api("GET", `/campaigns/${basicId}/settings/schedule`);
  rec("1b", "defaults present", freq.status === 200 && sched.status === 200,
    "freq+schedule 200", `freq=${freq.status} caps=${JSON.stringify(freq.json?.caps ?? freq.json).slice(0,120)} sched=${sched.status}`);

  // 2 create w/ mode
  r = await api("POST", "/campaigns", { name: "B1-mode", accountId: ctx.accountId, aiReplyMode: "approve_all" });
  const modeId = r.json?.id;
  const brain = await api("GET", `/campaigns/${modeId}/brain`);
  const mode = brain.json?.autonomy?.mode ?? brain.json?.autonomy?.reply_mode ?? JSON.stringify(brain.json?.autonomy);
  rec("2", "create w/ approve_all mode", String(mode).includes("approve_all"), "autonomy approve_all", `mode=${mode}`);

  // 3 patch settings merge
  await api("PATCH", `/campaigns/${modeId}`, { settings: { skip_already_contacted: false, follow_up_cap: 5, pause_ai_replies: true } });
  const after = await api("GET", `/campaigns/${modeId}`);
  const s = after.json?.settings ?? {};
  rec("3", "settings merge not replace",
    s.skip_already_contacted === false && s.follow_up_cap === 5 && s.pause_ai_replies === true && "exclude_conn_req_from_reply_rate" in s,
    "merged, original keys retained", JSON.stringify(s).slice(0, 200));

  // 4 empty patch
  r = await api("PATCH", `/campaigns/${modeId}`, {});
  rec("4", "empty patch 400", r.status === 400, "400 no fields", `${r.status} ${errMsg(r)}`);

  // 5 unbind + start
  await api("PATCH", `/campaigns/${modeId}`, { accountId: null });
  r = await api("POST", `/campaigns/${modeId}/start`, {});
  rec("5", "start w/o account 400", r.status === 400, "400 bind account", `${r.status} ${errMsg(r)}`);

  // 6 frequency clamp
  r = await api("PUT", `/campaigns/${basicId}/settings/frequency`, { caps: { connection_request: 500, message: 9999 } });
  const caps = r.json?.caps ?? {};
  const cr = caps.connection_request, msg = caps.message;
  rec("6", "frequency clamp above safe max",
    r.status < 300 && cr < 500 && msg < 9999,
    "clamped below requested", `status=${r.status} connection_request=${cr} message=${msg} warnings=${JSON.stringify(r.json?.warnings ?? r.json?.warning ?? "none").slice(0,150)}`,
    { bug: !(cr < 500 && msg < 9999), severity: cr < 500 ? "none" : "P1" });

  // 7 all-zero caps -> start 400
  const zeroBody: Record<string, number> = {};
  for (const k of Object.keys(caps)) zeroBody[k] = 0;
  await api("PUT", `/campaigns/${basicId}/settings/frequency`, { caps: zeroBody });
  await api("PATCH", `/campaigns/${basicId}`, { accountId: ctx.accountId });
  // need a node + lead? start checks caps before enroll; try start with a saved node
  await api("PUT", `/campaigns/${basicId}/sequence`, { nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  r = await api("POST", `/campaigns/${basicId}/start`, {});
  rec("7", "all-zero caps start 400", r.status === 400 && /cap/i.test(errMsg(r)), "400 all-zero caps", `${r.status} ${errMsg(r)}`);
  // restore caps
  await api("PUT", `/campaigns/${basicId}/settings/frequency`, { caps: { connection_request: 15, message: 30, visit_profile: 30 } });

  // 8 schedule inverted
  const mkSched = (mon: any) => ({
    schedule: {
      sun: { enabled: false, start: "09:00", end: "17:00" },
      mon, tue: { enabled: true, start: "09:00", end: "17:00" },
      wed: { enabled: true, start: "09:00", end: "17:00" },
      thu: { enabled: true, start: "09:00", end: "17:00" },
      fri: { enabled: true, start: "09:00", end: "17:00" },
      sat: { enabled: false, start: "09:00", end: "17:00" },
    },
  });
  r = await api("PUT", `/campaigns/${basicId}/settings/schedule`, mkSched({ enabled: true, start: "18:00", end: "09:00" }));
  rec("8", "schedule inverted 400", r.status === 400, "400 start<end", `${r.status} ${errMsg(r)}`);
  // 9 bad clock
  r = await api("PUT", `/campaigns/${basicId}/settings/schedule`, mkSched({ enabled: true, start: "25:00", end: "26:00" }));
  rec("9", "schedule bad clock 400", r.status === 400, "400 range", `${r.status} ${errMsg(r)}`);

  // 10 delete cascade
  r = await api("POST", "/campaigns", { name: "B1-delete" });
  const delId = r.json?.id;
  await api("PUT", `/campaigns/${delId}/sequence`, { nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  r = await api("DELETE", `/campaigns/${delId}`);
  const g = await api("GET", `/campaigns/${delId}`);
  rec("10", "delete + 404 after", r.status < 300 && g.status === 404, "deleted then 404", `del=${r.status} get=${g.status}`);

  // 11 KB grounding gate on default (balanced) mode
  r = await api("POST", "/campaigns", { name: "B1-kbgate", accountId: ctx.accountId });
  const kbId = r.json?.id;
  await api("PUT", `/campaigns/${kbId}/sequence`, { nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  await api("POST", `/campaigns/${kbId}/leads`, { leadIds: [ctx.leadIds.L6] });
  r = await api("POST", `/campaigns/${kbId}/start`, {});
  rec("11", "KB grounding gate on balanced default",
    r.status === 400 && /knowledge|ground/i.test(errMsg(r)),
    "400 mentions knowledge base", `${r.status} ${errMsg(r)}`,
    { notes: "UX: is the message actionable?" });
  await api("DELETE", `/campaigns/${kbId}/leads/${ctx.leadIds.L6}`);
}

// ---------------------------------------------------------------- B2 sequence
async function b2(): Promise<void> {
  let r = await api("POST", "/campaigns", { name: "B2-types" });
  const id = r.json?.id;

  const actionChain = [
    { id: "n1", kind: "action", type: "like_last_post", config: {}, next: "n2" },
    { id: "n2", kind: "action", type: "visit_profile", config: {}, next: "n3" },
    { id: "n3", kind: "action", type: "follow_lead", config: {}, next: "n4" },
    { id: "n4", kind: "action", type: "send_connection_request", config: {}, next: "n5" },
    { id: "n5", kind: "action", type: "send_message", config: { messageBody: { v: 1, segments: [{ type: "text", text: "Hi " }, { type: "variable", key: "first_name", fallback: "there" }] } }, next: "n6" },
    { id: "n6", kind: "action", type: "send_voice_note", config: {}, next: "n7" },
    { id: "n7", kind: "action", type: "inmail", config: {}, next: "n8" },
    { id: "n8", kind: "action", type: "send_message_to_open_profile", config: {}, next: "n9" },
    { id: "n9", kind: "action", type: "comment_last_post", config: {}, next: "n10" },
    { id: "n10", kind: "action", type: "reply_comment", config: { postUrl: "https://www.linkedin.com/posts/fake" }, next: "n11" },
    { id: "n11", kind: "action", type: "add_tag", config: { tag: "audit" }, next: "n12" },
    { id: "n12", kind: "action", type: "wait_x_days", config: {}, delayDays: 2, next: "n13" },
    { id: "n13", kind: "action", type: "visit_profile", config: {}, next: null },
  ];
  r = await api("PUT", `/campaigns/${id}/sequence`, { nodes: actionChain });
  const round = await api("GET", `/campaigns/${id}/sequence`);
  const savedTypes = (round.json?.nodes ?? []).map((n: any) => n.type).sort();
  const wantTypes = actionChain.map((n) => n.type).sort();
  rec("12", "all 13 action types round-trip", r.status < 300 && JSON.stringify(savedTypes) === JSON.stringify(wantTypes),
    "200 + all types persist", `status=${r.status} savedCount=${savedTypes.length}/${wantTypes.length}`);

  // 13 conditions branching
  const condGraph = [
    { id: "c1", kind: "condition", type: "has_linkedin_url", config: {}, true: "c2", false: "leafF" },
    { id: "c2", kind: "condition", type: "is_first_level", config: {}, true: "c3", false: "leafF" },
    { id: "c3", kind: "condition", type: "is_open_profile", config: {}, true: "c4", false: "leafF" },
    { id: "c4", kind: "condition", type: "check_data_in_column", config: { column: "segment", equals: "A" }, true: "c5", false: "leafF" },
    { id: "c5", kind: "condition", type: "invite_accepted", config: { waitDays: 2 }, true: "c6", false: "leafF" },
    { id: "c6", kind: "condition", type: "message_opened", config: {}, true: "c7", false: "leafF" },
    { id: "c7", kind: "condition", type: "message_replied", config: {}, true: "leafT", false: "leafF" },
    { id: "leafT", kind: "action", type: "add_tag", config: { tag: "yes" }, next: null },
    { id: "leafF", kind: "action", type: "visit_profile", config: {}, next: null },
  ];
  r = await api("PUT", `/campaigns/${id}/sequence`, { nodes: condGraph });
  const cround = await api("GET", `/campaigns/${id}/sequence`);
  const condCount = (cround.json?.nodes ?? []).filter((n: any) => n.kind === "condition").length;
  const hasBranches = (cround.json?.nodes ?? []).some((n: any) => n.true && n.false);
  rec("13", "all 7 conditions + branch edges", r.status < 300 && condCount === 7 && hasBranches,
    "200 + 7 conditions w/ true/false", `status=${r.status} conditions=${condCount} branches=${hasBranches}`);

  // probe campaign for rejections
  r = await api("POST", "/campaigns", { name: "B2-probe" });
  const pid = r.json?.id;
  const put = (nodes: any[]) => api("PUT", `/campaigns/${pid}/sequence`, { nodes });

  // 14 cycle
  r = await put([{ id: "a", kind: "action", type: "visit_profile", config: {}, next: "b" }, { id: "b", kind: "action", type: "like_last_post", config: {}, next: "a" }]);
  rec("14", "cycle rejected", r.status === 400, "400 cycle", `${r.status} ${errMsg(r)}`);

  // 15 unknown type
  r = await put([{ id: "a", kind: "action", type: "bogus_type", config: {}, next: null }]);
  rec("15", "unknown node type rejected", r.status === 400, "400 unknown type", `${r.status} ${errMsg(r)}`,
    { bug: r.status < 300, severity: r.status < 300 ? "P0" : "none", notes: r.status < 300 ? "SAVED unknown type — dispatch will silently skip" : "" });

  // 16 email types
  r = await put([{ id: "a", kind: "action", type: "send_email", config: {}, next: null }]);
  const emailAction = r.status;
  r = await put([{ id: "a", kind: "condition", type: "email_opened", config: {}, true: null, false: null }]);
  rec("16", "email node types rejected", emailAction === 400 && r.status === 400, "400 email not shipped", `send_email=${emailAction} email_opened=${r.status}`,
    { bug: emailAction < 300 || r.status < 300, severity: (emailAction < 300 || r.status < 300) ? "P1" : "none" });

  // 17 dangling
  r = await put([{ id: "a", kind: "action", type: "visit_profile", config: {}, next: "nonexistent" }]);
  rec("17", "dangling edge rejected", r.status === 400, "400 dangling", `${r.status} ${errMsg(r)}`);

  // 18 kind mismatch
  r = await put([{ id: "a", kind: "action", type: "invite_accepted", config: {}, next: null }]);
  rec("18", "kind/type mismatch", r.status === 400, "400 or documented", `${r.status} ${errMsg(r)}`,
    { bug: r.status < 300, severity: r.status < 300 ? "P2" : "none", notes: r.status < 300 ? "condition type saved as action kind" : "" });

  // 19 >200 nodes
  const many = Array.from({ length: 201 }, (_, i) => ({ id: `x${i}`, kind: "action", type: "visit_profile", config: {}, next: i < 200 ? `x${i + 1}` : null }));
  r = await put(many);
  rec("19", ">200 nodes rejected", r.status === 400, "400 max 200", `${r.status} ${errMsg(r).slice(0,80)}`);

  // 19b delayDays bounds
  r = await put([{ id: "a", kind: "action", type: "wait_x_days", config: {}, delayDays: 400, next: null }]);
  const dd400 = r.status;
  r = await put([{ id: "a", kind: "action", type: "wait_x_days", config: {}, delayDays: -1, next: null }]);
  rec("19b", "delayDays bounds enforced", dd400 === 400 && r.status === 400, "400 for 400 and -1", `dd400=${dd400} ddNeg=${r.status}`);

  // 19c config.days unvalidated bypass
  r = await put([{ id: "a", kind: "action", type: "wait_x_days", config: { days: 5000 }, delayDays: null, next: null }]);
  rec("19c", "wait config.days=5000 bypass probe", true, "document behavior", `save status=${r.status}`,
    { bug: r.status < 300, severity: r.status < 300 ? "P2" : "none", notes: r.status < 300 ? "config.days:5000 saved; engine reads config.days raw → ~13yr wait" : "rejected" });
}

// ---------------------------------------------------------------- B3 composer/AI
async function b3(): Promise<void> {
  let r = await api("POST", "/campaigns", { name: "B3-gen" });
  const id = r.json?.id;

  // 23 variable + fallback + no broken merge (use L8 sparse: firstName only, no company)
  r = await api("POST", "/ai/render-preview", {
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: ", saw " },
      { type: "variable", key: "company" },
      { type: "text", text: " is growing." },
    ],
    leadIds: [ctx.leadIds.L8, ctx.leadIds.L1],
  });
  const outputs = (r.json?.results ?? r.json?.previews ?? r.json ?? []);
  const outStr = JSON.stringify(outputs);
  const brokenMerge = /Hi ,|saw\s+is growing|saw\s{2,}/.test(outStr);
  rec("23", "variable fallback + no broken merges", r.status === 200 && !brokenMerge,
    "resolved, no 'Hi ,' or 'saw  is growing'", `status=${r.status} sample=${outStr.slice(0, 240)}`,
    { bug: brokenMerge, severity: brokenMerge ? "P1" : "none" });

  // 24 AI chip
  r = await api("POST", "/ai/render-preview", {
    segments: [
      { type: "text", text: "Hey " },
      { type: "variable", key: "first_name" },
      { type: "text", text: " — " },
      { type: "ai", prompt: "one short friendly observation about their company" },
    ],
    leadIds: [ctx.leadIds.L1, ctx.leadIds.L5],
  });
  rec("24", "AI chip renders (real Gemini)", r.status === 200,
    "200 + per-lead AI text", `status=${r.status} variety=${JSON.stringify(r.json?.varietyWarning ?? "none")} sample=${JSON.stringify(r.json?.results ?? r.json).slice(0, 220)}`);

  // 25 preview-samples
  r = await api("GET", `/campaigns/${id}/preview-samples`);
  rec("25", "preview-samples returns leads", r.status === 200, "200 + sample vars", `status=${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);

  // 26 prompt library
  const lib = await api("GET", "/ai/library");
  const created = await api("POST", "/ai/prompts", { name: "B3 prompt", template: "Write one line about {{company}}" });
  const ref = created.json?.ref ?? created.json?.id;
  const fav = ref ? await api("POST", "/ai/prompts/favorite", { ref, favorited: true }) : { status: 0, json: null, text: "" };
  const use = ref ? await api("POST", "/ai/prompts/use", { ref }) : { status: 0, json: null, text: "" };
  rec("26", "prompt library CRUD/favorite/use",
    lib.status === 200 && created.status < 300 && fav.status < 300 && use.status < 300,
    "all 200", `lib=${lib.status} create=${created.status} fav=${fav.status} use=${use.status} ref=${ref}`);

  // 26b ai status
  r = await api("GET", "/ai/status");
  rec("26b", "ai/status configured", r.status === 200, "200 configured", `${r.status} ${JSON.stringify(r.json).slice(0,120)}`);

  // 27 generate
  r = await api("POST", `/campaigns/${id}/generate`, { intake: { offer: "AI-powered CRM for dental clinics", audience: "dental clinic owners in DACH", goal: "book demos", tone: "gentle" }, skipClarify: true });
  const graph = r.json?.graph?.nodes ?? r.json?.nodes ?? r.json?.blueprint?.graph?.nodes ?? [];
  const types = graph.map((n: any) => n.type);
  const knownOnly = types.every((t: string) => /^(send_connection_request|send_message|send_voice_note|comment_last_post|reply_comment|like_last_post|visit_profile|inmail|send_message_to_open_profile|follow_lead|add_tag|wait_x_days|has_linkedin_url|is_first_level|is_open_profile|check_data_in_column|invite_accepted|message_opened|message_replied)$/.test(t));
  const connNode = graph.find((n: any) => n.type === "send_connection_request");
  const connNoNote = !connNode || !(connNode.config?.note || connNode.config?.messageBody);
  rec("27", "generate valid graph, no-note connection",
    r.status < 300 && graph.length > 0 && knownOnly && connNoNote,
    "known types, connreq no note", `status=${r.status} nodes=${graph.length} knownOnly=${knownOnly} connNoNote=${connNoNote} types=${JSON.stringify(types).slice(0,180)}`);

  // 28 clarify flow
  r = await api("POST", `/campaigns/${id}/generate`, { intake: { offer: "stuff", audience: "people", goal: "sales", tone: "balanced" }, full: true });
  const hasQuestions = Array.isArray(r.json?.questions) && r.json.questions.length > 0;
  rec("28", "clarify or blueprint flow", r.status < 300, "questions or blueprint", `status=${r.status} questions=${hasQuestions} keys=${Object.keys(r.json ?? {}).join(",")}`);

  // 30 workflows
  const wl = await api("GET", "/workflows");
  const created2 = await api("POST", "/workflows", { name: "B3 saved wf", nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  const wfId = created2.json?.id;
  const del = wfId ? await api("DELETE", `/workflows/${wfId}`) : { status: 0 };
  rec("30", "workflows list/save/delete", wl.status === 200 && created2.status < 300 && del.status < 300,
    "round trip", `list=${wl.status} save=${created2.status} del=${del.status}`);
}

// ---------------------------------------------------------------- B4 brain/KB
async function b4(): Promise<void> {
  let r = await api("POST", "/campaigns", { name: "B4-brain", accountId: ctx.accountId, aiReplyMode: "full_auto" });
  const id = r.json?.id;

  // 33 KB create + ingest text
  r = await api("POST", "/knowledge-bases", { name: "B4 KB" });
  const kbId = r.json?.id;
  const ing = await api("POST", `/knowledge-bases/${kbId}/ingest`, { text: "SimCorp Audit Product: AI outreach copilot. Pricing: Starter $49/mo, Pro $149/mo. Integrates with HubSpot. Founded 2024 in Berlin.", source: "audit" });
  const sources = await api("GET", `/knowledge-bases/${kbId}/sources`);
  rec("33", "KB create + ingest text + sources", r.status < 300 && ing.status < 300 && sources.status === 200,
    "created, ingested, listed", `kb=${r.status} ingest=${ing.status} sources=${sources.status} ${JSON.stringify(sources.json).slice(0,160)}`);

  // 34 ingest url + delete source
  const urlIng = await api("POST", `/knowledge-bases/${kbId}/ingest`, { url: "https://example.com", source: "url-test" });
  rec("34", "KB ingest url", true, "document behavior", `url ingest status=${urlIng.status} ${errMsg(urlIng).slice(0,120)}`);

  // 35 brain read/write
  const before = await api("GET", `/campaigns/${id}/brain`);
  r = await api("PUT", `/campaigns/${id}/brain`, {
    objective: { goal: "book demos", offer: "AI copilot", cta: "15-min call" },
    guardrails: { never_discuss: ["politics"], escalate_on: ["pricing negotiation"] },
    voice: { tone: "warm, concise" },
    autonomy: { mode: "full_auto", confidence_threshold: 0.6 },
    limits: { max_ai_turns: 4 },
    knowledgeBaseId: kbId,
  });
  const afterB = await api("GET", `/campaigns/${id}/brain`);
  rec("35", "brain read/write round-trip", r.status < 300 && afterB.json?.objective?.goal === "book demos" && afterB.json?.knowledgeBaseId === kbId,
    "objective+KB persisted", `put=${r.status} goal=${afterB.json?.objective?.goal} kb=${afterB.json?.knowledgeBaseId === kbId}`);

  // 36 budget
  const bud = await api("GET", `/campaigns/${id}/budget`);
  r = await api("PUT", `/campaigns/${id}/brain`, { budget: { daily_usd_cap: 1.0, alert_at_pct: 0.8 } });
  rec("36", "budget read + set", bud.status === 200 && r.status < 300, "200 + set", `get=${bud.status} set=${r.status} ${JSON.stringify(bud.json).slice(0,120)}`);

  // 37 ai-sdr settings toggle
  const g = await api("GET", "/ai-sdr/settings");
  const off = await api("PUT", "/ai-sdr/settings", { enabled: false });
  const on = await api("PUT", "/ai-sdr/settings", { enabled: true });
  rec("37", "ai-sdr master switch toggle", g.status === 200 && off.status < 300 && on.status < 300, "toggles", `get=${g.status} off=${off.status} on=${on.status}`);

  // 37b full_auto no-KB start gate
  r = await api("POST", "/campaigns", { name: "B4-nokb", accountId: ctx.accountId, aiReplyMode: "full_auto" });
  const nokb = r.json?.id;
  await api("PUT", `/campaigns/${nokb}/sequence`, { nodes: [{ id: "a", kind: "action", type: "visit_profile", config: {}, next: null }] });
  await api("POST", `/campaigns/${nokb}/leads`, { leadIds: [ctx.leadIds.L7] });
  r = await api("POST", `/campaigns/${nokb}/start`, {});
  rec("37b", "full_auto no-KB start blocked", r.status === 400, "400 KB gate", `${r.status} ${errMsg(r)}`);
  await api("DELETE", `/campaigns/${nokb}/leads/${ctx.leadIds.L7}`);
}

// ---------------------------------------------------------------- B7 aux
async function b7(): Promise<void> {
  let r = await api("POST", "/campaigns", { name: "B7-share" });
  const id = r.json?.id;
  await api("PUT", `/campaigns/${id}/sequence`, { nodes: [
    { id: "a", kind: "action", type: "visit_profile", config: {}, next: "b" },
    { id: "b", kind: "action", type: "send_connection_request", config: {}, next: null },
  ] });

  // 66 share
  r = await api("POST", `/campaigns/${id}/share`, {});
  const token1 = r.json?.shareToken ?? r.json?.token;
  const url = r.json?.url ?? r.json?.shareUrl;
  const r2 = await api("POST", `/campaigns/${id}/share`, {});
  const token2 = r2.json?.shareToken ?? r2.json?.token;
  rec("66", "share token idempotent", r.status < 300 && !!token1 && token1 === token2, "same token twice", `status=${r.status} token=${String(token1).slice(0,10)} same=${token1 === token2} url=${url}`);
  // fetch share page unauth (web)
  let sharePage = "n/a";
  if (url) {
    try {
      const res = await fetch(url.startsWith("http") ? url : `http://localhost:3000${url}`);
      sharePage = `${res.status}`;
    } catch (e) { sharePage = `err:${(e as Error).message.slice(0,40)}`; }
  }
  rec("66b", "share page renders unauth", sharePage.startsWith("200") || sharePage === "n/a", "200 html", `page=${sharePage}`);

  // 67 duplicate
  r = await api("POST", `/campaigns/${id}/duplicate`, { name: "B7-dup" });
  const dupId = r.json?.id ?? r.json?.newCampaignId ?? r.json?.campaignId;
  const dupSeq = await api("GET", `/campaigns/${dupId}/sequence`);
  const dupDetail = await api("GET", `/campaigns/${dupId}`);
  rec("67", "duplicate copies structure, 0 leads", r.status < 300 && (dupSeq.json?.nodes?.length ?? 0) === 2 && (dupDetail.json?.leadCount ?? 0) === 0,
    "structure copied, leads 0", `dup=${r.status} nodes=${dupSeq.json?.nodes?.length} leads=${dupDetail.json?.leadCount}`);

  // 68 ab-compare
  if (dupId) {
    r = await api("POST", "/campaigns/ab-compare", { campaignIds: [id, dupId] });
    rec("68", "ab-compare", r.status < 300, "metrics for both", `status=${r.status} ${JSON.stringify(r.json).slice(0,150)}`);
  }

  // 70 save-as-template surface
  const wt = await api("GET", "/workflow-templates");
  rec("70", "workflow-templates endpoint", wt.status === 200, "200 list", `GET /workflow-templates=${wt.status} ${JSON.stringify(wt.json).slice(0,120)}`);

  // 69b campaigns list
  r = await api("GET", "/campaigns");
  rec("69b", "campaigns list w/ metrics", r.status === 200 && Array.isArray(r.json), "200 array", `status=${r.status} count=${Array.isArray(r.json) ? r.json.length : "?"}`);
}

async function main(): Promise<void> {
  const run: Record<string, () => Promise<void>> = { b1, b2, b3, b4, b7 };
  const groups = group === "all" ? Object.keys(run) : [group];
  for (const g of groups) {
    if (run[g]) {
      try {
        await run[g]();
      } catch (e) {
        rec(`${g}-ERR`, `group ${g} threw`, false, "no throw", (e as Error).message);
      }
    }
  }
  console.log("AUDIT_RESULTS_START");
  console.log(JSON.stringify(results, null, 2));
  console.log("AUDIT_RESULTS_END");
  const fails = results.filter((r) => !r.pass);
  console.log(`\nSUMMARY: ${results.length - fails.length}/${results.length} passed`);
  for (const f of fails) console.log(`  FAIL ${f.id} ${f.name} :: ${f.observed}`);
}

main().catch((e: unknown) => {
  console.error("audit-run failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
