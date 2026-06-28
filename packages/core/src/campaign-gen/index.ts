// AI campaign generator (CLAUDE.md §7 sequence engine). Turns a natural-language
// intake into a STRUCTURED, editable sequence graph — constrained to the known
// node + condition types (it can never invent a node type), with safety enforced
// (no-note connection default; reply-driven auto-stop is engine-global). Pure: the
// LLM call lives in the API; this module builds the prompt, validates/repairs the
// model's JSON, provides a deterministic mock-safe fallback, and patches a graph
// for iterative refinement. NEVER launches anything.

import {
  extractAiPrompt,
  type MessageBody,
  messageBodyToTemplate,
  readMessageBody,
} from "../composer";

export type GenTone = "gentle" | "balanced" | "aggressive";

export interface GenerateIntake {
  offer: string;
  audience: string;
  goal: string;
  tone: GenTone;
  instructions?: string;
}

export interface GenNode {
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
}

export const ALLOWED_ACTION_TYPES = new Set([
  "send_connection_request",
  "send_message",
  "send_voice_note",
  "comment_last_post",
  "like_last_post",
  "visit_profile",
  "inmail",
  "add_tag",
  "reply_comment",
  "send_message_to_open_profile",
  "follow_lead",
  "wait_x_days",
]);

export const ALLOWED_CONDITION_TYPES = new Set([
  "has_linkedin_url",
  "is_first_level",
  "message_opened",
  "is_open_profile",
  "check_data_in_column",
  "invite_accepted",
  "message_replied",
]);

const MAX_NODES = 24;

function clampDays(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(1, Math.min(90, Math.round(n)));
}

/** Build a message-node config with an offer-tuned AI segment + soft question. */
function messageConfig(aiPrompt: string, softQuestion: string): Record<string, unknown> {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: ", " },
      { type: "ai", prompt: aiPrompt },
      { type: "text", text: ". " },
      { type: "text", text: softQuestion },
    ],
  };
  return { messageBody: body, body: messageBodyToTemplate(body), aiPrompt };
}

function tunedPrompt(intake: GenerateIntake): string {
  return (
    `Write one short, genuine observation that connects this lead to "${intake.offer}". ` +
    `Audience: ${intake.audience}. Casual, lowercase, no pitch, under 12 words.`
  );
}

/**
 * Deterministic, framework-correct generator used as the mock-safe fallback (and
 * whenever the LLM output can't be repaired). Tone shifts aggressiveness: gentle =
 * more warm-up + longer waits, aggressive = faster asks + InMail.
 */
export function deterministicGraph(intake: GenerateIntake): GenNode[] {
  const ai = tunedPrompt(intake);
  const soft = "what's your focus there right now?";
  const nodes: GenNode[] = [
    { kind: "action", type: "like_last_post", config: {} },
  ];

  if (intake.tone === "gentle") {
    nodes.push(
      { kind: "action", type: "visit_profile", config: {} },
      { kind: "action", type: "wait_x_days", config: { days: 2 } },
    );
  }

  nodes.push(
    { kind: "action", type: "send_connection_request", config: {} },
    { kind: "condition", type: "invite_accepted", config: {} },
    {
      kind: "action",
      type: "wait_x_days",
      config: { days: intake.tone === "aggressive" ? 1 : intake.tone === "gentle" ? 3 : 2 },
    },
    { kind: "action", type: "send_message", config: messageConfig(ai, soft) },
  );

  if (intake.tone === "aggressive") {
    nodes.push(
      { kind: "action", type: "wait_x_days", config: { days: 2 } },
      {
        kind: "action",
        type: "inmail",
        config: { subject: "quick one", ...messageConfig(ai, "open to a quick chat?") },
      },
    );
  } else {
    nodes.push(
      { kind: "action", type: "wait_x_days", config: { days: 3 } },
      { kind: "action", type: "send_voice_note", config: { voiceMode: "ai_clone", durationMs: 20_000 } },
      { kind: "action", type: "send_message", config: { body: "Quick voice note for context 🎙️" } },
    );
  }

  if (intake.tone === "gentle") {
    nodes.push(
      { kind: "action", type: "wait_x_days", config: { days: 4 } },
      { kind: "action", type: "comment_last_post", config: {} },
    );
  }

  return enforceSafety(nodes);
}

/**
 * Validate + repair a node list (from the LLM or refinement): drop unknown types,
 * strip connection-request notes (no-note default — §2), clamp wait days, and cap
 * the total. Message nodes are normalized to carry a structured messageBody.
 */
export function enforceSafety(nodes: GenNode[]): GenNode[] {
  const out: GenNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const kind = node.kind === "condition" ? "condition" : "action";
    const allowed = kind === "condition" ? ALLOWED_CONDITION_TYPES : ALLOWED_ACTION_TYPES;
    if (!allowed.has(node.type)) {
      continue; // never invent a node type
    }
    const config = node.config && typeof node.config === "object" ? { ...node.config } : {};

    if (node.type === "send_connection_request") {
      delete (config as Record<string, unknown>).note; // no-note default
    }
    if (node.type === "wait_x_days") {
      config.days = clampDays((config as Record<string, unknown>).days, 2);
    }
    if (["send_message", "inmail", "send_message_to_open_profile", "comment_last_post"].includes(node.type)) {
      const hasStructured =
        config.messageBody && typeof config.messageBody === "object";
      if (!hasStructured) {
        const mb = readMessageBody(config as Record<string, unknown>, ["body", "message", "text"]);
        config.messageBody = mb;
        const aiPrompt = extractAiPrompt(mb);
        config[node.type === "comment_last_post" ? "text" : "body"] = messageBodyToTemplate(mb);
        if (aiPrompt) {
          config.aiPrompt = aiPrompt;
        }
      }
    }

    out.push({ kind, type: node.type, config });
    if (out.length >= MAX_NODES) {
      break;
    }
  }
  return out;
}

/** System + user prompt instructing the LLM to emit a strict node-graph JSON. */
export function buildGenerationPrompt(intake: GenerateIntake): { system: string; prompt: string } {
  const actions = [...ALLOWED_ACTION_TYPES].join(", ");
  const conditions = [...ALLOWED_CONDITION_TYPES].join(", ");
  const system =
    "You design LinkedIn outreach sequences using the 'start conversations, don't sell' methodology. " +
    "Connection requests carry NO note. Prefer a personalized observation + a soft question. " +
    "Output ONLY JSON, no prose.";
  const prompt =
    `Design a sequence as JSON: {"nodes":[{"kind":"action|condition","type":"...","config":{...}}]}.\n` +
    `Allowed action types: ${actions}.\n` +
    `Allowed condition types: ${conditions}.\n` +
    `Never use any other type. For message nodes use config.body with {first_name} and an config.aiPrompt ` +
    `instruction tuned to the offer. Use wait_x_days (config.days) between touches.\n\n` +
    `Offer: ${intake.offer}\nAudience: ${intake.audience}\nGoal: ${intake.goal}\nTone: ${intake.tone}\n` +
    (intake.instructions ? `Extra instructions: ${intake.instructions}\n` : "");
  return { system, prompt };
}

/** Parse the LLM's JSON into a safe graph; falls back to deterministic on failure. */
export function parseGeneratedGraph(raw: string, intake: GenerateIntake): GenNode[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return deterministicGraph(intake);
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { nodes?: unknown };
    const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as GenNode[]) : [];
    const safe = enforceSafety(nodes);
    return safe.length >= 2 ? safe : deterministicGraph(intake);
  } catch {
    return deterministicGraph(intake);
  }
}

function insertAfter(nodes: GenNode[], predicate: (n: GenNode) => boolean, toInsert: GenNode[]): GenNode[] {
  const idx = nodes.findIndex(predicate);
  if (idx === -1) {
    return [...nodes, ...toInsert];
  }
  return [...nodes.slice(0, idx + 1), ...toInsert, ...nodes.slice(idx + 1)];
}

/**
 * Patch an existing graph from a natural-language instruction (iterative
 * refinement). Deterministic rules cover the common asks; unknown instructions
 * leave the graph unchanged. Always re-runs enforceSafety.
 */
export function applyRefinement(graph: GenNode[], instruction: string): GenNode[] {
  const i = instruction.toLowerCase();
  let next = [...graph];

  if (/remove.*(inmail)/.test(i)) {
    next = next.filter((n) => n.type !== "inmail");
  }
  if (/remove.*(voice)/.test(i)) {
    next = next.filter((n) => n.type !== "send_voice_note");
  }
  if (/(add|insert).*(voice)/.test(i)) {
    next = insertAfter(next, (n) => n.type === "send_message", [
      { kind: "action", type: "send_voice_note", config: { voiceMode: "ai_clone", durationMs: 20_000 } },
    ]);
  }
  if (/(add|insert).*(inmail)/.test(i) && !next.some((n) => n.type === "inmail")) {
    next.push({ kind: "action", type: "inmail", config: { subject: "quick one", body: "Hi {first_name}, open to a quick chat?" } });
  }
  if (/(add|insert).*(follow.?up|message)/.test(i)) {
    next.push(
      { kind: "action", type: "wait_x_days", config: { days: 3 } },
      { kind: "action", type: "send_message", config: { body: "Hi {first_name}, circling back — worth a quick chat?" } },
    );
  }
  if (/gentl|softer|slower|warm/.test(i)) {
    next = next.map((n) =>
      n.type === "wait_x_days"
        ? { ...n, config: { ...n.config, days: clampDays(n.config.days, 2) + 2 } }
        : n,
    );
    next = next.filter((n) => n.type !== "inmail");
  }
  if (/aggressive|faster|quicker|push/.test(i)) {
    next = next.map((n) =>
      n.type === "wait_x_days"
        ? { ...n, config: { ...n.config, days: Math.max(1, clampDays(n.config.days, 2) - 1) } }
        : n,
    );
    if (!next.some((n) => n.type === "inmail")) {
      next.push({ kind: "action", type: "inmail", config: { subject: "quick one", body: "Hi {first_name}, open to a quick chat?" } });
    }
  }

  return enforceSafety(next);
}

// Phase 6 — prompt-to-FULL-campaign blueprint (graph + brain + KB seed). Lives in
// a sibling file; re-exported so `@10xconnect/core` exposes one campaign-gen API.
export * from "./full-campaign";
