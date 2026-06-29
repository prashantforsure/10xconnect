/**
 * LIVE end-to-end scenario harness (real Unipile transport) — selling an AI
 * automation service via LinkedIn outreach to a single, operator-owned test
 * account. This drives the REAL pipeline: it builds a campaign with full brain
 * context, sends a real opener DM through the ChannelAdapter, then runs a polling
 * bridge that pulls the prospect's replies from Unipile and feeds them through the
 * exact production inbound + conversation-turn path (processInboundEvent →
 * dispatchDueActions → brain → autonomy → reply send).
 *
 * Nothing here imports a provider SDK — sends/reads go through createChannelAdapter
 * (ADAPTER=unipile). It NEVER calls the global worker loop on a schedule; each
 * dispatch tick is explicit and observable.
 *
 * Subcommands:
 *   setup   — resolve providerId, build KB + campaign + brain + opener node, enroll
 *   start   — mark the campaign running + schedule the opener (no send yet)
 *   run [s] — poll inbound + dispatch due actions for ~s seconds (default 90),
 *             printing the live transcript. The opener fires on the first tick.
 *   status  — print transcript, drafts, relationship, budget, action log
 *   stop    — stop the campaign + cancel pending actions
 *
 * Run from repo root, e.g.:
 *   pnpm --filter @10xconnect/worker exec tsx src/live-scenario.ts setup
 */
import {
  createChannelAdapter,
  createEmbeddingAdapter,
  createTextAdapter,
  resolveAdapterKind,
} from "@10xconnect/adapters";
import { env } from "@10xconnect/config";
import { createDb, type DB } from "@10xconnect/db";
import type { ChannelAdapter, Conversation } from "@10xconnect/core";
import {
  createCachedAiResolver,
  dispatchConfigFromEnv,
  dispatchDueActions,
  type EngineDeps,
  enrollLeads,
  ingestText,
  previewNode,
  processInboundEvent,
  startCampaign,
  stopCampaign,
} from "@10xconnect/engine";
import type { Kysely } from "kysely";

const WS_NAME = "xyz";
const LEAD_URL = "https://www.linkedin.com/in/prashant-patel-11198a285/";
const CAMPAIGN_NAME = "LIVE — Complex AI Sequence";
const KB_NAME = "AI Automation — offer & FAQ";

// Whole-message AI opener. The engine generates this PER-PROSPECT from enrichment
// (headline, about, company, role, recent posts) → a personalized observation + soft
// question. No link, no pitch. We test whether the model actually reads the profile.
const MESSAGE_PROMPT =
  "Write a short, warm LinkedIn opener to this person (max 2 sentences, under 45 words). " +
  "Open with a specific, genuine observation drawn from their headline or a recent post, then " +
  "ask one easy, low-friction question to start a conversation. No pitch, no links, no empty " +
  "compliments. Plain, peer-to-peer tone.";

// Whole-comment AI. The engine feeds the prospect's most-recent post text (from
// enrichment.recentPosts) into the model so the comment reacts to the actual post.
const COMMENT_PROMPT =
  "Look at their most recent post and react to the specific idea in it the way a peer would — " +
  "one short sentence — then ask one genuine, low-friction question about it. Casual tone, " +
  "lowercase is fine. No empty compliments, no pitch, no links.";

/** Build a whole-message AI body (a single AI chip) → node config.messageBody. */
function aiBody(prompt: string): Record<string, unknown> {
  return { messageBody: { v: 1, segments: [{ type: "ai", prompt }] } };
}

// Campaign brain context (CLAUDE.md §7 / packages/core/src/brain). Grounds Turns 1
// & 2 (what we do / who it's for) but deliberately NOT specific 3rd-party beta APIs
// or pricing — so an out-of-KB integration question and any pricing/buying turn
// escalate instead of fabricating.
const KB_TEXT = [
  "What we do: We build custom AI automations for small and mid-sized businesses and agencies. We take repetitive, manual work — inbound lead handling, follow-up sequences, data entry between tools, reporting, and first-line support triage — and turn it into reliable automated workflows tailored to the team's existing tools and process. We are a done-for-you service, not a generic SaaS product: each automation is scoped, built, and maintained for the specific business.",
  "Who it's for: Our typical clients are founders, operations leads, and agency owners at companies with roughly 10 to 200 employees. They usually have a small team, a growing volume of repetitive tasks, and no spare engineering time to build internal tooling. Agencies use us to automate client onboarding, reporting, and routine account work so their people focus on strategy.",
  "Example use cases: routing and replying to inbound leads, syncing data between a CRM and spreadsheets or billing tools, automated weekly reporting pulled from multiple sources, document and proposal generation, support-ticket triage and tagging, and recurring data clean-up. We start with one high-friction workflow that wastes the most time, prove it out, then expand.",
  "How we work: We begin with a short discovery call to understand the workflow and the tools involved. From there we map the process, build the automation, test it against real data, and hand it over with monitoring in place. Most first automations go live within a couple of weeks. We stay on to maintain and adjust them as the business changes.",
  "Why teams choose us: bespoke automations built around how the team already works rather than forcing a rigid tool; fast time-to-value by starting with one painful workflow; and ongoing maintenance so automations keep working as tools and processes change. The goal is to give a small team the leverage of a much larger ops function.",
  "Typical results clients describe: hours of repetitive manual work removed each week, faster response times to inbound leads, and fewer errors from manual copy-paste between systems. Outcomes vary by workflow and tooling, so we scope expectations during discovery rather than promising fixed numbers.",
  "Common questions: We work with the tools you already use and integrate through their standard, supported interfaces. If a tool is unusual or an integration is uncertain, we confirm feasibility during discovery before committing. We do not take on work we cannot reliably deliver.",
].join("\n\n");

const OBJECTIVE = {
  goal: "Book a 20-minute discovery call to scope one AI automation that saves the prospect time.",
  offer:
    "Custom, done-for-you AI automation for SMBs and agencies — bespoke automations for lead handling, follow-ups, data sync, reporting, and support triage, built around the team's existing tools.",
  success_criteria: "The prospect agrees to a short discovery call.",
  icp: "Founders, ops leads, and agency owners at companies with 10–200 employees.",
  cta: "Suggest a quick 20-minute call to explore one automation.",
};
const GUARDRAILS = {
  never_discuss: ["exact pricing", "quotes", "contracts", "legal terms", "guaranteed results"],
  escalate_on: ["pricing", "contract", "legal", "competitor"],
};
const VOICE = {
  tone: "friendly, peer-to-peer, concise — a helpful operator, never a pushy salesperson",
  samples: [
    "Totally get that — most teams we talk to are drowning in small repetitive tasks.",
    "Happy to share a couple of examples of what that could look like for your setup.",
  ],
};
const AUTONOMY = { mode: "auto_easy_escalate_hard", confidence_threshold: 0.5 };
const LIMITS = { max_ai_turns: 6, cooldown_minutes: 0 };
const BUDGET = { daily_usd_cap: 2, alert_at_pct: 0.8 };

function buildDeps(db: Kysely<DB>, adapter: ChannelAdapter): EngineDeps {
  const textAdapter = createTextAdapter();
  const embeddingAdapter = createEmbeddingAdapter();
  const deps: EngineDeps = {
    db,
    adapter,
    config: dispatchConfigFromEnv(),
    textAdapter,
    embeddingAdapter,
    modelLabel: env.LLM_PROVIDER === "mock" ? "mock" : env.LLM_MODEL,
    log: (msg) => console.log(`  [engine] ${msg}`),
  };
  deps.resolveContent = createCachedAiResolver(deps);
  return deps;
}

async function ctx() {
  const db = createDb();
  const ws = await db.selectFrom("workspaces").select(["id", "name"]).where("name", "=", WS_NAME).executeTakeFirstOrThrow();
  const account = await db
    .selectFrom("sending_accounts")
    .select(["id", "provider_account_id", "status"])
    .where("workspace_id", "=", ws.id)
    .where("type", "=", "linkedin")
    .executeTakeFirstOrThrow();
  const lead = await db
    .selectFrom("leads")
    .select(["id", "linkedin_url", "enrichment", "connection_degree"])
    .where("workspace_id", "=", ws.id)
    .where("linkedin_url", "=", LEAD_URL)
    .executeTakeFirstOrThrow();
  return { db, wsId: ws.id, account, lead };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function findCampaign(db: Kysely<DB>, wsId: string): Promise<string | null> {
  const row = await db
    .selectFrom("campaigns")
    .select("id")
    .where("workspace_id", "=", wsId)
    .where("name", "=", CAMPAIGN_NAME)
    .executeTakeFirst();
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------

async function setup(): Promise<void> {
  const { db, wsId, account, lead } = await ctx();
  const adapter = createChannelAdapter(resolveAdapterKind());
  const deps = buildDeps(db, adapter);
  console.log(`workspace=${wsId} account=${account.id} (${account.status}) provider=${account.provider_account_id}`);

  // 1) Resolve providerId + REFRESH full enrichment (headline/about/company/role/
  //    location/degree + recent posts). We always re-read so the message AI has fresh
  //    profile signal and the comment AI has the CURRENT latest-post text — and so the
  //    post we analyze is the same one comment_last_post will target.
  console.log("fetching recipient profile from Unipile (providerId + enrichment + recent posts)…");
  const profile = await adapter.fetchProfile(
    { accountId: account.id, providerAccountId: account.provider_account_id ?? undefined },
    lead.linkedin_url ?? LEAD_URL,
  );
  const prevE = asObj(lead.enrichment);
  const merged: Record<string, unknown> = {
    ...prevE,
    providerId: profile.providerId ?? prevE.providerId,
    firstName: profile.firstName ?? prevE.firstName,
    lastName: profile.lastName ?? prevE.lastName,
    headline: profile.headline ?? prevE.headline,
    about: profile.about ?? prevE.about,
    company: profile.company ?? prevE.company,
    role: profile.role ?? prevE.role,
    location: profile.location ?? prevE.location,
    ...(profile.recentPosts?.length ? { recentPosts: profile.recentPosts } : {}),
    enrichedAt: new Date().toISOString(),
  };
  await db
    .updateTable("leads")
    .set({
      enrichment: JSON.stringify(merged) as never,
      ...(typeof profile.connectionDegree === "number" ? { connection_degree: profile.connectionDegree } : {}),
    })
    .where("id", "=", lead.id)
    .execute();
  lead.enrichment = merged as never;
  const providerId = merged.providerId as string | undefined;
  const postCount = Array.isArray(merged.recentPosts) ? merged.recentPosts.length : 0;
  console.log(
    `  providerId=${providerId} name=${merged.firstName ?? "?"} degree=${profile.connectionDegree ?? "?"} ` +
      `headline="${String(merged.headline ?? "").slice(0, 60)}" recentPosts=${postCount}`,
  );
  if (postCount === 0) {
    console.log("  ⚠ no recent posts captured — like_last_post/comment_last_post may 404 and the comment AI will be generic.");
  }

  // 2) Knowledge base + embedded chunks (idempotent: reuse by name).
  let kb = await db.selectFrom("knowledge_bases").select("id").where("workspace_id", "=", wsId).where("name", "=", KB_NAME).executeTakeFirst();
  if (!kb) {
    kb = await db.insertInto("knowledge_bases").values({ workspace_id: wsId, name: KB_NAME, description: "Offer, ICP, use cases, process, FAQ" }).returning("id").executeTakeFirstOrThrow();
    if (!deps.embeddingAdapter) throw new Error("no embedding adapter (set EMBEDDING_PROVIDER/LLM_API_KEY)");
    const res = await ingestText(db, deps.embeddingAdapter, { workspaceId: wsId, knowledgeBaseId: kb.id, text: KB_TEXT, source: "live-scenario" });
    console.log(`KB created ${kb.id} — ${res.chunks} chunks embedded`);
  } else {
    const n = await db.selectFrom("kb_chunks").select((eb) => eb.fn.countAll<number>().as("n")).where("knowledge_base_id", "=", kb.id).executeTakeFirst();
    console.log(`KB reused ${kb.id} — ${Number(n?.n ?? 0)} chunks`);
  }

  // 3) Campaign with full brain context (idempotent: reuse by name).
  let campaignId = await findCampaign(db, wsId);
  if (!campaignId) {
    const schedule = weekScheduleAlwaysOn();
    const created = await db
      .insertInto("campaigns")
      .values({
        workspace_id: wsId,
        name: CAMPAIGN_NAME,
        status: "draft",
        account_id: account.id,
        schedule: JSON.stringify(schedule) as never,
        caps: JSON.stringify({}) as never,
        settings: JSON.stringify({ skip_already_contacted: false }) as never,
        objective: JSON.stringify(OBJECTIVE) as never,
        guardrails: JSON.stringify(GUARDRAILS) as never,
        voice: JSON.stringify(VOICE) as never,
        autonomy: JSON.stringify(AUTONOMY) as never,
        limits: JSON.stringify(LIMITS) as never,
        budget: JSON.stringify(BUDGET) as never,
        knowledge_base_id: kb.id,
      } as never)
      .returning("id")
      .executeTakeFirstOrThrow();
    campaignId = created.id;
    console.log(`campaign created ${campaignId}`);
  } else {
    await db
      .updateTable("campaigns")
      .set({
        account_id: account.id,
        objective: JSON.stringify(OBJECTIVE) as never,
        guardrails: JSON.stringify(GUARDRAILS) as never,
        voice: JSON.stringify(VOICE) as never,
        autonomy: JSON.stringify(AUTONOMY) as never,
        limits: JSON.stringify(LIMITS) as never,
        budget: JSON.stringify(BUDGET) as never,
        knowledge_base_id: kb.id,
      } as never)
      .where("id", "=", campaignId)
      .execute();
    console.log(`campaign reused ${campaignId} (brain context refreshed)`);
  }

  // 4) Build the 4-node sequence: visit → like → message(AI) → comment(AI). Rebuild
  //    fresh each setup (clear prior nodes + this campaign's lead state) so re-runs
  //    start clean. Root = the node with no incoming edge (visit_profile).
  await db.deleteFrom("lead_campaign_state").where("campaign_id", "=", campaignId).execute();
  await db.deleteFrom("sequence_nodes").where("campaign_id", "=", campaignId).execute();
  const mkNode = async (type: string, config: Record<string, unknown>, next: string | null): Promise<string> => {
    const row = await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: wsId,
        campaign_id: campaignId,
        kind: "action",
        type,
        config: JSON.stringify(config) as never,
        next_node_id: next,
        delay_days: 0,
      } as never)
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  };
  // Insert tail-first so each node can point next_node_id at the one after it.
  const commentId = await mkNode("comment_last_post", aiBody(COMMENT_PROMPT), null);
  const messageId = await mkNode("send_message", aiBody(MESSAGE_PROMPT), commentId);
  const likeId = await mkNode("like_last_post", {}, messageId);
  const visitId = await mkNode("visit_profile", {}, likeId);
  console.log(
    `sequence built: visit(${visitId.slice(0, 8)}) → like(${likeId.slice(0, 8)}) → ` +
      `message(${messageId.slice(0, 8)}) → comment(${commentId.slice(0, 8)})`,
  );

  // 5) Enroll the single lead.
  const enroll = await enrollLeads(deps, wsId, campaignId, [lead.id]);
  console.log(`enroll: ${JSON.stringify(enroll)}`);

  // 6) Preview the AI message + comment for THIS lead (real model, NO send). previewNode
  //    warms the per-prospect cache keyed by (node, contact, prompt_version) — so what
  //    you see here is EXACTLY what dispatch sends (no second LLM call at send time).
  const msgPrev = await previewNode(deps, { workspaceId: wsId, campaignId, nodeId: messageId, nodeType: "send_message", config: aiBody(MESSAGE_PROMPT), leadIds: [lead.id], force: true });
  const cmtPrev = await previewNode(deps, { workspaceId: wsId, campaignId, nodeId: commentId, nodeType: "comment_last_post", config: aiBody(COMMENT_PROMPT), leadIds: [lead.id], force: true });
  console.log("\n── AI PREVIEW (exactly what will send) ─────────────────────────");
  console.log(`DM      → ${msgPrev.results[0]?.text || "(empty — AI produced nothing; check enrichment)"}`);
  console.log(`COMMENT → ${cmtPrev.results[0]?.text || "(empty — AI produced nothing; check enrichment)"}`);
  console.log("────────────────────────────────────────────────────────────────");

  if (deps.embeddingAdapter) {
    const { retrieveChunks } = await import("@10xconnect/engine");
    for (const q of ["What exactly does your service do?", "What kind of businesses do you work with?", "Do you integrate with the Pipedrive beta automation API?", "How much does this cost?"]) {
      const hits = await retrieveChunks(db, deps.embeddingAdapter, kb.id, q, 1);
      console.log(`  grounding "${q}" → top sim=${hits[0]?.similarity?.toFixed(3) ?? "—"}`);
    }
  }
  await db.destroy();
  console.log("\nsetup complete. Review the opener above, then: start → run");
}

function weekScheduleAlwaysOn() {
  const day = { enabled: true, start: "00:00", end: "23:59" };
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day, timezone: "UTC" };
}

async function start(): Promise<void> {
  const { db, wsId } = await ctx();
  const campaignId = await findCampaign(db, wsId);
  if (!campaignId) throw new Error("run setup first");
  const adapter = createChannelAdapter(resolveAdapterKind());
  const deps = buildDeps(db, adapter);
  const res = await startCampaign(deps, wsId, campaignId);
  console.log(`campaign started — scheduled ${res.scheduled} lead(s). Opener is queued; run to dispatch.`);
  await db.destroy();
}

/** Pull the live thread from Unipile and feed any NEW inbound messages through the
 *  real inbound pipeline. Returns provider message ids seen (for logging). */
async function pollInbound(deps: EngineDeps, account: { id: string; provider_account_id: string | null }, lead: { id: string; providerId?: string; linkedinUrl: string }): Promise<number> {
  if (!lead.providerId) return 0;
  let convo: Conversation;
  try {
    convo = await deps.adapter.fetchConversation(
      { accountId: account.id, providerAccountId: account.provider_account_id ?? undefined },
      { leadId: lead.id, providerId: lead.providerId, linkedinUrl: lead.linkedinUrl },
    );
  } catch (err) {
    console.log(`  [poll] fetchConversation failed: ${String(err)}`);
    return 0;
  }
  let processed = 0;
  // fetchConversation returns newest-first; feed oldest-first so our messages
  // table's created_at order matches the real thread order.
  const ordered = [...convo.messages].sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
  for (const m of ordered) {
    if (m.direction !== "inbound" || !m.body) continue;
    const id = m.providerMessageId ?? `inbound:${m.sentAt}`;
    const r = await processInboundEvent(deps, {
      id,
      accountId: account.id,
      channel: "linkedin",
      occurredAt: m.sentAt ?? new Date().toISOString(),
      type: "reply",
      lead: { leadId: lead.id, providerId: lead.providerId, linkedinUrl: lead.linkedinUrl },
      message: { body: m.body },
    } as never);
    if (r.status === "processed") {
      processed += 1;
      console.log(`  [poll] NEW inbound → "${m.body.slice(0, 80)}"`);
    }
  }
  return processed;
}

async function run(seconds: number): Promise<void> {
  const { db, wsId, account, lead } = await ctx();
  const adapter = createChannelAdapter(resolveAdapterKind());
  const deps = buildDeps(db, adapter);
  const providerId = asObj(lead.enrichment).providerId as string | undefined;
  console.log(`adapter=${resolveAdapterKind()} model=${env.LLM_MODEL} — running ${seconds}s. Reply on LinkedIn from the recipient account to drive the conversation.\n`);

  const deadline = Date.now() + seconds * 1000;
  let tick = 0;
  while (Date.now() < deadline) {
    tick += 1;
    const newInbound = await pollInbound(deps, account, { id: lead.id, providerId, linkedinUrl: lead.linkedin_url ?? LEAD_URL });
    // Drain the action queue a few times so a turn → reply chain completes in one tick.
    for (let i = 0; i < 4; i += 1) {
      const stats = await dispatchDueActions(deps);
      if (stats.claimed > 0) console.log(`  [tick ${tick}] dispatch ${JSON.stringify(stats)}`);
      if (stats.claimed === 0) break;
    }
    if (newInbound > 0) await printTranscript(db, wsId, lead.id);
    await sleep(5000);
  }
  console.log("\nrun window ended.");
  await printTranscript(db, wsId, lead.id);
  await db.destroy();
}

async function printTranscript(db: Kysely<DB>, wsId: string, leadId: string): Promise<void> {
  const convo = await db.selectFrom("conversations").select(["id", "pipeline_stage", "needs_attention", "is_important"]).where("workspace_id", "=", wsId).where("lead_id", "=", leadId).executeTakeFirst();
  if (!convo) {
    console.log("  (no conversation yet — opener sent, awaiting first reply)");
    return;
  }
  const msgs = await db.selectFrom("messages").select(["direction", "body", "created_at"]).where("conversation_id", "=", convo.id).orderBy("created_at", "asc").execute();
  console.log(`\n── transcript (stage=${convo.pipeline_stage} important=${convo.is_important} needsAttn=${convo.needs_attention}) ──`);
  for (const m of msgs) console.log(`  ${m.direction === "inbound" ? "◀ them" : "▶ us  "}: ${m.body}`);
  const drafts = await db.selectFrom("message_drafts").select(["status", "body", "confidence", "reasoning"]).where("conversation_id", "=", convo.id).orderBy("created_at", "asc").execute();
  for (const d of drafts) {
    const reason = asObj(d.reasoning as unknown);
    console.log(`  · draft[${d.status}] conf=${d.confidence ?? "—"} ${d.body ? `body="${d.body.slice(0, 90)}"` : `(escalated: ${reason.reason ?? reason.autonomy ?? "—"})`}`);
  }
}

async function status(): Promise<void> {
  const { db, wsId, lead } = await ctx();
  const campaignId = await findCampaign(db, wsId);
  console.log(`campaign=${campaignId}`);
  await printTranscript(db, wsId, lead.id);
  const rel = await db.selectFrom("relationship_state").select(["stage", "do_not_reply", "intent_score", "ai_turn_count", "summary"]).where("lead_id", "=", lead.id).executeTakeFirst();
  if (rel) console.log(`\nrelationship: stage=${rel.stage} doNotReply=${rel.do_not_reply} intent=${rel.intent_score} aiTurns=${rel.ai_turn_count}${rel.summary ? `\n  summary: ${rel.summary.slice(0, 240)}` : ""}`);
  if (campaignId) {
    const ledger = await db.selectFrom("budget_ledger").select(["window", "tokens_used", "usd_used"]).where("campaign_id", "=", campaignId).execute();
    for (const l of ledger) console.log(`budget ${l.window}: tokens=${l.tokens_used} usd=${l.usd_used}`);
    const acts = await db.selectFrom("actions").select(["type", "status", "executed_at", "result"]).where("campaign_id", "=", campaignId).orderBy("created_at", "asc").execute();
    console.log(`actions (${acts.length}):`);
    for (const a of acts) {
      const detail = a.status === "failed" || a.status === "skipped" ? ` :: ${JSON.stringify(a.result)?.slice(0, 240)}` : "";
      console.log(`  ${a.type} → ${a.status}${a.executed_at ? ` @ ${a.executed_at}` : ""}${detail}`);
    }
  }
  await db.destroy();
}

/**
 * Re-enable the brain on a lead whose relationship was escalated/stopped in a prior
 * session (do_not_reply=true) so the conversation loop can be tested again. NON-
 * destructive: it does NOT delete messages/conversations/lead_events, so the real
 * LinkedIn thread is never re-ingested — only the reply gate + turn budget are reset.
 */
async function resetRelationship(): Promise<void> {
  const { db, lead } = await ctx();
  const res = await db
    .updateTable("relationship_state")
    .set({ do_not_reply: false, ai_turn_count: 0 } as never)
    .where("lead_id", "=", lead.id)
    .executeTakeFirst();
  console.log(`relationship gate reset for lead ${lead.id}: do_not_reply=false, ai_turn_count=0 (rows=${Number(res.numUpdatedRows ?? 0)})`);
  await db.destroy();
}

async function stop(): Promise<void> {
  const { db, wsId } = await ctx();
  const campaignId = await findCampaign(db, wsId);
  if (!campaignId) throw new Error("no campaign");
  const adapter = createChannelAdapter(resolveAdapterKind());
  await stopCampaign(buildDeps(db, adapter), wsId, campaignId);
  console.log("campaign stopped + pending actions cancelled.");
  await db.destroy();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const cmd = process.argv[2];
const arg = process.argv[3];
(async () => {
  switch (cmd) {
    case "setup": await setup(); break;
    case "start": await start(); break;
    case "run": await run(arg ? Number(arg) : 90); break;
    case "status": await status(); break;
    case "reset": await resetRelationship(); break;
    case "stop": await stop(); break;
    default: console.log("usage: tsx src/live-scenario.ts <setup|start|run [seconds]|status|reset|stop>");
  }
})().catch((e: unknown) => {
  console.error("live-scenario failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
