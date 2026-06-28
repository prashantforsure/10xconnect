// AI prompt-to-campaign generator (Phase 6). Extends the node-graph generator
// (./index) into a FULL campaign blueprint: objective + success criteria + ICP +
// guardrails + voice + autonomy defaults + cadence + a message-skeleton graph
// (with AI chips) + a KNOWLEDGE-BASE SEED (structure/section prompts, never real
// facts) + the required_inputs the user must still supply (grounding docs,
// contacts, sender, voice).
//
// Two hard rules carried from §2 + Phase 4–5:
//  - STRUCTURE is reusable; REAL FACTS are always the user's input. The blueprint
//    NEVER fabricates pricing, claims, or KB content — it emits a structure the
//    user fills, and grounding is REQUIRED before launch (launchReadiness()).
//  - The graph is validated/clamped to the known node types (enforceSafety) — the
//    generator can never invent a node type, and connection requests stay no-note.
//
// Pure + deterministic-by-default (mock-safe): the LLM call lives in the API; this
// module builds the prompt, parses/repairs the model JSON, and provides a fully
// deterministic fallback blueprint so "Build with AI" works with no LLM key.

import {
  type AutonomyMode,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../brain";
import { clampCaps, type DailyCaps, defaultDailyCaps } from "../safety";

import {
  deterministicGraph,
  enforceSafety,
  type GenerateIntake,
  type GenNode,
  type GenTone,
} from "./index";

// --- Blueprint shape -------------------------------------------------------

export interface BlueprintObjective {
  goal: string;
  success_criteria: string;
  icp: string;
  cta: string;
}

export interface BlueprintGuardrails {
  never_discuss: string[];
  escalate_on: string[];
}

export interface BlueprintAutonomy {
  mode: AutonomyMode;
  confidence_threshold: number;
}

export interface BlueprintCadence {
  /** Tone-adjusted per-action daily caps (already clamped to safe maxima). */
  caps: DailyCaps;
}

/** A KB section the user fills with REAL facts; `prompt` says what goes here. */
export interface KnowledgeSeedSection {
  title: string;
  prompt: string;
}

/** Structure for a grounding knowledge base — NO content, only section prompts. */
export interface KnowledgeSeed {
  name: string;
  description: string;
  sections: KnowledgeSeedSection[];
}

export type RequiredInputKind = "account" | "leads" | "knowledge_base" | "voice";

/** Something the blueprint can't invent — the user must supply it before launch. */
export interface RequiredInput {
  key: "sender_account" | "contacts" | "knowledge_base" | "voice_profile";
  kind: RequiredInputKind;
  label: string;
  /** A hard gate on launch when true (see launchReadiness). */
  required: boolean;
}

export interface CampaignBlueprint {
  objective: BlueprintObjective;
  guardrails: BlueprintGuardrails;
  voice: { tone: string };
  autonomy: BlueprintAutonomy;
  cadence: BlueprintCadence;
  /** Validated/clamped message-skeleton graph (known node types only). */
  graph: GenNode[];
  /** Grounding KB STRUCTURE (section prompts) — the user fills it with real facts. */
  knowledgeSeed: KnowledgeSeed;
  /** What the user must still provide (sender, contacts, grounding, voice). */
  requiredInputs: RequiredInput[];
}

const MAX_GUARDRAILS = 25;

// --- Clarifying-question flow ---------------------------------------------

/** A field is "thin" if it's effectively a placeholder (1 word / very short). */
function isThin(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  return v.length < 8 || v.split(/\s+/).length < 2;
}

/**
 * If the intake is under-specified, return up to 2 clarifying questions to ask
 * BEFORE generating (so the campaign isn't built on guesses). Returns [] when the
 * intake is specific enough to generate from.
 */
export function clarifyingQuestions(intake: GenerateIntake): string[] {
  const questions: string[] = [];
  if (isThin(intake.offer)) {
    questions.push("What exactly are you offering, and what outcome does it deliver — in one sentence?");
  }
  if (isThin(intake.audience)) {
    questions.push("Who is the ideal buyer — what role, and what kind of company (size / industry)?");
  }
  if (isThin(intake.goal)) {
    questions.push("What does a successful conversation lead to — a booked call, a demo, or just a reply?");
  }
  return questions.slice(0, 2);
}

// --- Deterministic blueprint (mock-safe fallback) --------------------------

function clean(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : fallback;
}

const TONE_VOICE: Record<GenTone, string> = {
  gentle: "warm, curious, low-pressure; never salesy",
  balanced: "friendly, concise, peer-to-peer; never salesy",
  aggressive: "direct, confident, concise; still respectful, never pushy",
};

/** Tone graduates the default autonomy: gentler tone → more human review. */
const TONE_AUTONOMY: Record<GenTone, AutonomyMode> = {
  gentle: "approve_all",
  balanced: "auto_easy_escalate_hard",
  aggressive: "auto_easy_escalate_hard",
};

function deriveSuccessCriteria(goal: string): string {
  const g = goal.toLowerCase();
  if (/(call|meeting|demo|book)/.test(g)) return "A booked intro call or demo.";
  if (/(repl|conversation|chat|connect)/.test(g)) return "A genuine reply that starts a conversation.";
  return "A positive reply that opens a real conversation.";
}

function deriveCta(goal: string): string {
  const g = goal.toLowerCase();
  if (/(call|meeting|demo|book)/.test(g)) return "Suggest a short, low-friction intro call.";
  return "Invite a low-friction next step (a quick reply or a short call).";
}

/** Default grounding KB structure — section PROMPTS only, never facts. */
export function defaultKnowledgeSeed(intake: GenerateIntake): KnowledgeSeed {
  const offer = clean(intake.offer, "your offer");
  return {
    name: `${offer.slice(0, 60)} — knowledge base`,
    description:
      "Grounding facts the AI must use when replying. Fill each section with REAL, specific details — the AI never invents facts and escalates to you when it lacks grounding.",
    sections: [
      { title: "What we offer", prompt: "Describe the product/service in 2–3 plain sentences." },
      { title: "Who it's for", prompt: "The ideal customer and the specific problem you solve for them." },
      {
        title: "Pricing & plans",
        prompt: "Tiers, what's included, and any trial — so pricing questions can be answered (otherwise the AI escalates).",
      },
      { title: "Proof & case studies", prompt: "Concrete results, named customers, or metrics you can cite." },
      { title: "Objections & FAQs", prompt: "Common objections and your honest, non-pushy responses." },
    ],
  };
}

/** Tone-adjusted, safe-clamped caps (gentle slows down; aggressive nudges up). */
function cadenceFor(tone: GenTone): BlueprintCadence {
  const base = defaultDailyCaps();
  const factor = tone === "gentle" ? 0.6 : tone === "aggressive" ? 1.25 : 1;
  const requested: Partial<DailyCaps> = {};
  for (const [k, v] of Object.entries(base)) {
    requested[k as keyof DailyCaps] = Math.max(1, Math.round(v * factor));
  }
  // clampCaps guarantees we never exceed researched safe maxima (§2/§6).
  return { caps: clampCaps(requested).caps };
}

/**
 * Compute what the user must still supply. The graph's AI chips need grounding,
 * so a knowledge base is REQUIRED whenever the sequence drafts/personalizes with
 * AI; a voice profile is required only when the graph sends a voice note.
 */
export function computeRequiredInputs(graph: GenNode[]): RequiredInput[] {
  const hasAi = graph.some(
    (n) =>
      n.type === "send_voice_note" ||
      (isMessageBody(n.config.messageBody) && n.config.messageBody.segments.some((s) => s.type === "ai")) ||
      typeof n.config.aiPrompt === "string",
  );
  const hasVoice = graph.some((n) => n.type === "send_voice_note");
  return [
    { key: "sender_account", kind: "account", label: "LinkedIn sending account", required: true },
    { key: "contacts", kind: "leads", label: "Contacts / leads to enroll", required: true },
    {
      key: "knowledge_base",
      kind: "knowledge_base",
      label: "Knowledge base (grounding facts the AI replies from)",
      required: hasAi,
    },
    { key: "voice_profile", kind: "voice", label: "Voice profile (for voice notes)", required: hasVoice },
  ];
}

function isMessageBody(value: unknown): value is { segments: { type: string }[] } {
  return !!value && typeof value === "object" && Array.isArray((value as { segments?: unknown }).segments);
}

/** Fully deterministic blueprint (used when no LLM, or to repair bad output). */
export function deterministicBlueprint(intake: GenerateIntake): CampaignBlueprint {
  const graph = deterministicGraph(intake);
  return {
    objective: {
      goal: clean(intake.goal, "Start genuine conversations"),
      success_criteria: deriveSuccessCriteria(intake.goal),
      icp: clean(intake.audience, "the target audience"),
      cta: deriveCta(intake.goal),
    },
    guardrails: {
      never_discuss: [],
      // Escalate (don't auto-handle) the topics that need a human + real facts.
      escalate_on: ["pricing", "contract", "legal", "security review", "competitor comparison"],
    },
    voice: { tone: TONE_VOICE[intake.tone] },
    autonomy: { mode: TONE_AUTONOMY[intake.tone], confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD },
    cadence: cadenceFor(intake.tone),
    graph,
    knowledgeSeed: defaultKnowledgeSeed(intake),
    requiredInputs: computeRequiredInputs(graph),
  };
}

// --- Validation / repair of model output -----------------------------------

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function strArr(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((s) => s.trim().slice(0, 200)).slice(0, max)
    : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function repairAutonomy(value: unknown): BlueprintAutonomy {
  const o = asObject(value);
  const mode: AutonomyMode =
    o.mode === "full_auto" || o.mode === "auto_easy_escalate_hard" || o.mode === "approve_all"
      ? o.mode
      : "approve_all";
  const t = typeof o.confidence_threshold === "number" ? o.confidence_threshold : DEFAULT_CONFIDENCE_THRESHOLD;
  return { mode, confidence_threshold: Math.min(1, Math.max(0, t)) };
}

function repairKnowledgeSeed(value: unknown, intake: GenerateIntake): KnowledgeSeed {
  const o = asObject(value);
  const rawSections = Array.isArray(o.sections) ? o.sections : [];
  const sections: KnowledgeSeedSection[] = rawSections
    .map((s) => {
      const so = asObject(s);
      // Keep ONLY title + prompt — never persist any model-supplied "content"/facts.
      return { title: str(so.title), prompt: str(so.prompt) };
    })
    .filter((s) => s.title.length > 0)
    .slice(0, 12);
  const fallback = defaultKnowledgeSeed(intake);
  return {
    name: str(o.name) || fallback.name,
    description: str(o.description) || fallback.description,
    sections: sections.length > 0 ? sections : fallback.sections,
  };
}

/**
 * Validate + repair a raw blueprint object (from the LLM) into a safe, schema-valid
 * CampaignBlueprint. Unknown node types are dropped (enforceSafety), autonomy/caps
 * are clamped, the KB seed is reduced to title+prompt, and requiredInputs are
 * recomputed from the SAFE graph (never trusted from the model).
 */
export function enforceBlueprintSafety(raw: unknown, intake: GenerateIntake): CampaignBlueprint {
  const o = asObject(raw);
  const fallback = deterministicBlueprint(intake);

  const rawGraph = Array.isArray(o.graph)
    ? (o.graph as GenNode[])
    : Array.isArray(o.nodes)
      ? (o.nodes as GenNode[])
      : [];
  const safeGraph = enforceSafety(rawGraph);
  const graph = safeGraph.length >= 2 ? safeGraph : fallback.graph;

  const objIn = asObject(o.objective);
  const objective: BlueprintObjective = {
    goal: str(objIn.goal) || fallback.objective.goal,
    success_criteria: str(objIn.success_criteria) || fallback.objective.success_criteria,
    icp: str(objIn.icp) || fallback.objective.icp,
    cta: str(objIn.cta) || fallback.objective.cta,
  };

  const grIn = asObject(o.guardrails);
  const guardrails: BlueprintGuardrails = {
    never_discuss: strArr(grIn.never_discuss, MAX_GUARDRAILS),
    escalate_on: strArr(grIn.escalate_on, MAX_GUARDRAILS).length
      ? strArr(grIn.escalate_on, MAX_GUARDRAILS)
      : fallback.guardrails.escalate_on,
  };

  const voiceTone = str(asObject(o.voice).tone) || str(o.voice) || fallback.voice.tone;

  return {
    objective,
    guardrails,
    voice: { tone: voiceTone },
    autonomy: o.autonomy !== undefined ? repairAutonomy(o.autonomy) : fallback.autonomy,
    // Cadence stays OURS (tone-clamped safe caps) — never trust model-supplied volumes.
    cadence: fallback.cadence,
    graph,
    knowledgeSeed: repairKnowledgeSeed(o.knowledgeSeed ?? o.knowledge_seed, intake),
    requiredInputs: computeRequiredInputs(graph),
  };
}

/** Parse the LLM's JSON into a safe blueprint; deterministic fallback on failure. */
export function parseBlueprint(rawText: string, intake: GenerateIntake): CampaignBlueprint {
  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return deterministicBlueprint(intake);
    }
    const parsed = JSON.parse(rawText.slice(start, end + 1));
    return enforceBlueprintSafety(parsed, intake);
  } catch {
    return deterministicBlueprint(intake);
  }
}

/** System + user prompt instructing the LLM to emit a full-campaign blueprint JSON. */
export function buildBlueprintPrompt(intake: GenerateIntake): { system: string; prompt: string } {
  const system =
    "You design B2B LinkedIn outreach CAMPAIGNS using the 'start conversations, don't sell' methodology. " +
    "Connection requests carry NO note; prefer a personalized observation + a soft question. " +
    "You NEVER invent facts (pricing, claims, customers) — instead you produce a knowledge-base STRUCTURE the user fills. " +
    "Output ONLY JSON, no prose.";
  const prompt =
    `Produce a campaign blueprint as JSON with this exact shape:\n` +
    `{"objective":{"goal","success_criteria","icp","cta"},` +
    `"guardrails":{"never_discuss":[],"escalate_on":[]},` +
    `"voice":{"tone"},` +
    `"autonomy":{"mode":"approve_all|auto_easy_escalate_hard|full_auto","confidence_threshold":0..1},` +
    `"graph":[{"kind":"action|condition","type":"...","config":{...}}],` +
    `"knowledgeSeed":{"name","description","sections":[{"title","prompt"}]}}\n` +
    `For "graph": use ONLY the known node types; message nodes use config.body with {first_name} and a config.aiPrompt ` +
    `tuned to the offer; separate touches with wait_x_days (config.days). ` +
    `For "knowledgeSeed.sections": each item is a TITLE + a PROMPT telling the user what real facts to add — ` +
    `do NOT put any actual facts, pricing, or claims in the JSON.\n\n` +
    `Offer: ${intake.offer}\nAudience: ${intake.audience}\nGoal: ${intake.goal}\nTone: ${intake.tone}\n` +
    (intake.instructions ? `Extra instructions: ${intake.instructions}\n` : "");
  return { system, prompt };
}

// --- Launch readiness (grounding gate) -------------------------------------

/**
 * A campaign generated from a prompt only goes live once the user supplies the
 * real facts the blueprint can't invent. Every `required` input must be satisfied;
 * grounding (knowledge_base) is required for any AI-bearing sequence, so this gate
 * enforces "collect grounding before launch".
 */
export function launchReadiness(
  requiredInputs: RequiredInput[],
  provided: Partial<Record<RequiredInput["key"], boolean>>,
): { ready: boolean; missing: RequiredInput[] } {
  const missing = requiredInputs.filter((r) => r.required && !provided[r.key]);
  return { ready: missing.length === 0, missing };
}
