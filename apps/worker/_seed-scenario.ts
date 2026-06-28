// One-off setup: seed the "Scenario Test" campaign end-to-end in workspace "xyz"
// (KB + grounded brain + branching workflow + enroll the test lead). Idempotent —
// re-running replaces the KB + campaign. Uses Gemini embeddings for KB ingestion
// (works); needs NO Unipile (live enrich/sends are a separate, user-driven step).

import { randomUUID } from "node:crypto";

import { createEmbeddingAdapter } from "@10xconnect/adapters";
import { createDb } from "@10xconnect/db";
import { ingestText } from "@10xconnect/engine";

const WS = "e7914746-3f55-4b87-9993-d47d89c03766"; // "xyz"
const ACCOUNT = "3fc59d75-87c0-4f77-9f0c-d7a1eb184a2c"; // live LinkedIn account
const TEST_LEAD = "6a45f893-5292-48c8-b4e9-49dd234f378a"; // Harshit (1st-degree, enriched)
const KB_NAME = "10xConnect Sales KB";
const CAMPAIGN_NAME = "Scenario Test";

// AI message body (structure fixed; the observation is AI-written per lead from
// their profile + recent activity). messageBody is the canonical form both the
// composer and the dispatch executor read.
const OPENER_PROMPT =
  "In one short, friendly sentence (max 12 words), open with a SPECIFIC observation about " +
  "what this person has recently been posting about or their current focus/role. Then end with " +
  "a soft, low-friction question. No pitch, no links. Casual; lowercase is fine.";
const FOLLOWUP_PROMPT =
  "Write a brief, warm one-sentence follow-up (max 15 words) from a different angle that adds a " +
  "little value. No pressure, no pitch. End with an easy yes/no question.";

function aiBody(prompt: string, lead = true) {
  const segments: unknown[] = lead
    ? [
        { type: "text", text: "Hi " },
        { type: "variable", key: "first_name" },
        { type: "text", text: ", " },
        { type: "ai", prompt },
      ]
    : [{ type: "ai", prompt }];
  return { messageBody: { v: 1, segments }, aiPrompt: prompt };
}

const CAPS = {
  connection_request: 15,
  message: 30,
  voice_note: 20,
  inmail: 5,
  open_profile_message: 30,
  comment_post: 30,
  reply_comment: 30,
  like_post: 30,
  visit_profile: 30,
  follow_lead: 30,
};
const SCHEDULE = {
  sun: { enabled: false, start: "09:00", end: "18:00" },
  mon: { enabled: true, start: "09:00", end: "18:00" },
  tue: { enabled: true, start: "09:00", end: "18:00" },
  wed: { enabled: true, start: "09:00", end: "18:00" },
  thu: { enabled: true, start: "09:00", end: "18:00" },
  fri: { enabled: true, start: "09:00", end: "18:00" },
  sat: { enabled: false, start: "09:00", end: "18:00" },
};

// KB sources (the facts the AI may answer from). Pricing/contracts deliberately
// NOT included → those questions hit the grounding guard / escalate guardrail.
const KB_SOURCES: { source: string; text: string }[] = [
  {
    source: "Product overview",
    text: "10xConnect is a LinkedIn + email outreach platform for sales teams, founders, and agencies. It runs personalized, multi-step campaigns that start conversations and book calls, while keeping your LinkedIn account safe. The AI personalizes every message from the prospect's profile and recent activity, and can hold a back-and-forth conversation grounded in your knowledge base.",
  },
  {
    source: "How it works & onboarding",
    text: "Onboarding takes about 15 minutes: connect your LinkedIn account once, import your contacts, add your campaign context (what you're offering and your goal), build a simple workflow, and launch. Campaigns then run automatically inside your working hours. You can watch replies land in a unified inbox and take over any conversation at any time.",
  },
  {
    source: "Account safety",
    text: "Account safety is the top priority. Actions are paced roughly 4 to 8 minutes apart and capped per day per account (for example connection requests and messages have separate daily limits). New accounts are warmed up gradually. If LinkedIn flags or restricts the account, the system auto-pauses sending and notifies you. We never exceed the safe daily limits even if asked.",
  },
  {
    source: "FAQ",
    text: "It works on LinkedIn and email. Messages are personalized per prospect, not templated blasts. The AI can answer a prospect's questions automatically when the answer is in your knowledge base; if it isn't, it marks the thread 'reply required' for a human instead of guessing. A reply auto-stops the outbound sequence so you never double-message someone who already responded.",
  },
  {
    source: "Escalation policy",
    text: "Pricing specifics, quotes, discounts, contracts, and legal or compliance questions are always handled by a human. The AI does not quote prices or discuss contract terms; it hands those threads to you, flagged as important.",
  },
];

async function main(): Promise<void> {
  const db = createDb();
  const embedder = createEmbeddingAdapter();
  if (!embedder) throw new Error("No embedding adapter (set EMBEDDING/LLM key).");

  // --- 1) Knowledge base (replace if it exists) ----------------------------
  await db.deleteFrom("knowledge_bases").where("workspace_id", "=", WS).where("name", "=", KB_NAME).execute();
  const kb = await db
    .insertInto("knowledge_bases")
    .values({ workspace_id: WS, name: KB_NAME, description: "Grounding for the Scenario Test campaign." })
    .returning("id")
    .executeTakeFirstOrThrow();
  let chunks = 0;
  for (const s of KB_SOURCES) {
    const r = await ingestText(db, embedder, { workspaceId: WS, knowledgeBaseId: kb.id, text: s.text, source: s.source });
    chunks += r.chunks;
  }
  console.log(`KB "${KB_NAME}" (${kb.id}): ${KB_SOURCES.length} sources, ${chunks} chunks`);

  // --- 2) Campaign + brain (replace if it exists) --------------------------
  await db.deleteFrom("campaigns").where("workspace_id", "=", WS).where("name", "=", CAMPAIGN_NAME).execute();
  const campaign = await db
    .insertInto("campaigns")
    .values({
      workspace_id: WS,
      name: CAMPAIGN_NAME,
      status: "draft",
      account_id: ACCOUNT,
      caps: JSON.stringify(CAPS),
      schedule: JSON.stringify(SCHEDULE),
      settings: JSON.stringify({ skip_already_contacted: true, exclude_conn_req_from_reply_rate: true, follow_up_cap: 3 }),
      objective: JSON.stringify({
        goal: "Start a genuine conversation and book a short intro call.",
        offer: "10xConnect — personalized LinkedIn + email outreach that keeps your account safe.",
        success_criteria: "A booked 15-minute intro call.",
        cta: "Open to a quick 15-min call this week?",
      }),
      guardrails: JSON.stringify({
        never_discuss: ["competitor names"],
        escalate_on: ["pricing", "price", "cost", "quote", "discount", "contract", "legal"],
      }),
      voice: JSON.stringify({ tone: "warm, concise, peer-to-peer; never salesy" }),
      autonomy: JSON.stringify({ mode: "auto_easy_escalate_hard", confidence_threshold: 0.7 }),
      knowledge_base_id: kb.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // --- 3) Branching workflow (tree; no convergence so the builder renders) --
  // like → is_first_level? ─ true → message(AI) → wait3 → replied? ─ false → follow-up(AI)
  //                        └ false → connect → invite_accepted? ─ true → message(AI)
  const n = {
    like: randomUUID(),
    isFirst: randomUUID(),
    msg: randomUUID(),
    wait: randomUUID(),
    replied: randomUUID(),
    followup: randomUUID(),
    connect: randomUUID(),
    accepted: randomUUID(),
    msg2: randomUUID(),
  };
  const node = (
    id: string,
    kind: "action" | "condition",
    type: string,
    config: object,
    edges: { next?: string; t?: string; f?: string; delay?: number } = {},
  ) => ({
    id,
    workspace_id: WS,
    campaign_id: campaign.id,
    kind,
    type,
    config: JSON.stringify(config),
    next_node_id: edges.next ?? null,
    true_node_id: edges.t ?? null,
    false_node_id: edges.f ?? null,
    delay_days: edges.delay ?? null,
  });

  await db
    .insertInto("sequence_nodes")
    .values([
      node(n.like, "action", "like_last_post", {}, { next: n.isFirst }),
      node(n.isFirst, "condition", "is_first_level", {}, { t: n.msg, f: n.connect }),
      node(n.msg, "action", "send_message", aiBody(OPENER_PROMPT), { next: n.wait }),
      node(n.wait, "action", "wait_x_days", { days: 3 }, { next: n.replied, delay: 3 }),
      node(n.replied, "condition", "message_replied", {}, { t: undefined, f: n.followup }),
      node(n.followup, "action", "send_message", aiBody(FOLLOWUP_PROMPT, false), {}),
      node(n.connect, "action", "send_connection_request", {}, { next: n.accepted }),
      node(n.accepted, "condition", "invite_accepted", {}, { t: n.msg2, f: undefined }),
      node(n.msg2, "action", "send_message", aiBody(OPENER_PROMPT), {}),
    ])
    .execute();
  console.log(`Campaign "${CAMPAIGN_NAME}" (${campaign.id}): 9 nodes, autonomy=auto_easy_escalate_hard, KB linked`);

  // --- 4) Enroll the test lead (active, unstarted) -------------------------
  await db
    .insertInto("lead_campaign_state")
    .values({ workspace_id: WS, lead_id: TEST_LEAD, campaign_id: campaign.id, status: "active", history: JSON.stringify([]) })
    .onConflict((oc) => oc.columns(["campaign_id", "lead_id"]).doNothing())
    .execute();
  console.log(`Enrolled test lead ${TEST_LEAD} (Harshit).`);

  console.log("\n=== DONE ===");
  console.log("campaignId:", campaign.id);
  console.log("knowledgeBaseId:", kb.id);
  console.log("leadId:", TEST_LEAD);
  await db.destroy();
}

main().catch((e: unknown) => {
  console.error("seed-scenario FAILED:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
