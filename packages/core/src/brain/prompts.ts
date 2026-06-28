// Conversation-brain config + the grounded DRAFT prompt (pure). The draft is
// reasoning-model work: in the user's voice, grounded STRICTLY in retrieved
// knowledge, <=150 tokens. Grounding is enforced upstream (the guard escalates
// factual questions with no chunk); the prompt reinforces "never invent facts".

import type { TextGenerationInput } from "../ai/text-adapter";

import type { TurnAction } from "./analysis";

export interface ObjectiveConfig {
  goal?: string;
  /** What we're offering (product/service + value prop). Grounds the AI's positioning. */
  offer?: string;
  success_criteria?: string;
  icp?: string;
  cta?: string;
}
export interface GuardrailsConfig {
  never_discuss?: string[];
  escalate_on?: string[];
}
export interface VoiceConfig {
  tone?: string;
  samples?: string[];
}
export type AutonomyMode = "approve_all" | "auto_easy_escalate_hard" | "full_auto";
export interface AutonomyConfig {
  mode: AutonomyMode;
  confidence_threshold?: number;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function objectiveFrom(json: unknown): ObjectiveConfig {
  const o = obj(json);
  return {
    goal: str(o.goal),
    offer: str(o.offer),
    success_criteria: str(o.success_criteria),
    icp: str(o.icp),
    cta: str(o.cta),
  };
}
export function guardrailsFrom(json: unknown): GuardrailsConfig {
  const o = obj(json);
  return { never_discuss: strArr(o.never_discuss), escalate_on: strArr(o.escalate_on) };
}
export function voiceFrom(json: unknown): VoiceConfig {
  const o = obj(json);
  return { tone: str(o.tone), samples: strArr(o.samples) };
}
export function autonomyFrom(json: unknown): AutonomyConfig {
  const o = obj(json);
  const mode = o.mode === "auto_easy_escalate_hard" || o.mode === "full_auto" ? o.mode : "approve_all";
  const threshold = typeof o.confidence_threshold === "number" ? o.confidence_threshold : undefined;
  return { mode, confidence_threshold: threshold };
}

export interface DraftPromptInput {
  action: TurnAction;
  lastMessage: string;
  chunks: string[]; // retrieved KB chunk bodies (the ONLY factual source)
  facts: string[]; // known facts about this lead
  summary: string | null;
  history: { direction: "inbound" | "outbound"; body: string }[];
  objective: ObjectiveConfig;
  guardrails: GuardrailsConfig;
  voice: VoiceConfig;
}

const ACTION_HINT: Record<TurnAction, string> = {
  answer: "Answer their question using ONLY the knowledge below.",
  objection: "Acknowledge their concern and reframe gently — do not be pushy.",
  qualify: "Ask one light qualifying question to understand their situation.",
  cta: "Propose a low-friction next step (a short call or a quick resource).",
  nurture: "Keep it warm and human; add value, don't pitch.",
  escalate: "", // escalate never drafts
  wait: "",
};

/** Build the grounded reply-draft prompt for the reasoning model. */
export function buildDraftPrompt(input: DraftPromptInput): TextGenerationInput {
  const { voice, guardrails, objective } = input;

  const systemLines = [
    "You are replying on LinkedIn as the user, in a 1:1 conversation. Sound like a real person, not a bot.",
    voice.tone ? `Voice/tone: ${voice.tone}.` : "Voice/tone: warm, concise, peer-to-peer; never salesy.",
    "Rules:",
    "- Ground every factual claim STRICTLY in the KNOWLEDGE provided. If the answer isn't in the knowledge, say you'll check and get back to them — NEVER invent pricing, features, or specifics.",
    "- Keep it under 150 tokens. No links. One soft question or next step at most.",
    "- Don't repeat what you already said in the history.",
  ];
  if (guardrails.never_discuss?.length) {
    systemLines.push(`- Never discuss: ${guardrails.never_discuss.join(", ")}.`);
  }
  if (voice.samples?.length) {
    systemLines.push("", "Write in the style of these samples:", ...voice.samples.slice(0, 3).map((s) => `"""${s}"""`));
  }

  const parts: string[] = [];
  if (objective.goal) parts.push(`Your goal in this campaign: ${objective.goal}`);
  if (objective.offer) parts.push(`What you're offering: ${objective.offer}`);
  if (objective.success_criteria) parts.push(`What a win looks like: ${objective.success_criteria}`);
  if (objective.cta) parts.push(`Preferred call-to-action: ${objective.cta}`);
  if (input.summary) parts.push(`Where the relationship stands: ${input.summary}`);
  if (input.facts.length) {
    parts.push(`What you know about them:\n${input.facts.map((f) => `- ${f}`).join("\n")}`);
  }
  if (input.chunks.length) {
    parts.push(
      `KNOWLEDGE (your only source of facts):\n${input.chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`,
    );
  } else {
    parts.push("KNOWLEDGE: (none retrieved — do not state any specific facts.)");
  }
  if (input.history.length) {
    const hist = input.history
      .slice(-6)
      .map((m) => `${m.direction === "inbound" ? "Them" : "You"}: ${m.body}`)
      .join("\n");
    parts.push(`Recent conversation:\n${hist}`);
  }
  parts.push(`Their latest message: "${input.lastMessage}"`);
  if (ACTION_HINT[input.action]) parts.push(`This turn: ${ACTION_HINT[input.action]}`);
  parts.push("Write only the reply text (no preamble, no quotes).");

  return {
    prompt: parts.join("\n\n"),
    system: systemLines.join("\n"),
    maxTokens: 220,
    temperature: 0.6,
  };
}
