// Conversation-brain analysis (pure). The cheap "classify + extract" step is a
// deterministic heuristic in v1 — reliable, free, and testable offline (no LLM
// JSON-mode dependency). The reasoning DRAFT still goes through the LLM. This
// boundary can later be swapped for a cheap LLM classifier behind the same types.

export type Intent =
  | "question"
  | "objection"
  | "interested"
  | "not_interested"
  | "meeting"
  | "smalltalk"
  | "other";

export type Sentiment = "positive" | "neutral" | "negative";

/** What the brain decided to do this turn. `escalate` → no draft, hand to human. */
export type TurnAction =
  | "answer"
  | "objection"
  | "qualify"
  | "cta"
  | "nurture"
  | "escalate"
  | "wait";

export interface Classification {
  intent: Intent;
  sentiment: Sentiment;
  isQuestion: boolean;
  /** A question whose answer must come from the knowledge base (grounding guard). */
  isFactualQuestion: boolean;
  /** Whether reflection should persist a fact (skip trivial greetings — token saving). */
  hasNewInfo: boolean;
  /** Derived topic key — facts upsert by (lead_id, topic). */
  topic: string;
  /** Applied to relationship_state.intent_score on reflection. */
  intentDelta: number;
}

const QUESTION_WORDS =
  /^(what|how|when|where|why|which|who|do|does|did|can|could|is|are|will|would|should|any)\b/i;

// Keywords that make a question one we must answer from the KB, never from memory.
const FACTUAL_KEYWORDS = [
  "pric", "cost", "plan", "fee", "expensive", "cheap", "discount", "quote", "budget",
  "feature", "integrat", "support", "work", "compatib", "api", "security", "compliance",
  "gdpr", "soc", "trial", "demo", "refund", "contract", "sla", "limit", "seat", "user",
  "onboard", "migrat", "data", "export", "setup", "install",
];

const POSITIVE = [
  "interested", "great", "love", "awesome", "perfect", "sounds good", "sure", "yes",
  "happy to", "let's", "lets", "sounds great", "definitely", "absolutely", "keen",
];
const NEGATIVE = [
  "not interested", "no thanks", "no thank", "stop", "unsubscribe", "remove me",
  "too expensive", "can't", "cannot", "won't", "not now", "busy", "leave me",
];
const MEETING = ["call", "meeting", "demo", "calendar", "book", "schedule", "chat", "zoom", "available"];

function has(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/** Deterministic classification of a prospect's inbound message. */
export function classifyInbound(raw: string): Classification {
  const text = (raw ?? "").toLowerCase().trim();
  const firstWord = text.split(/\s+/)[0] ?? "";
  const isQuestion = text.includes("?") || QUESTION_WORDS.test(firstWord);
  const factual = isQuestion && FACTUAL_KEYWORDS.some((k) => text.includes(k));

  let intent: Intent = "other";
  let sentiment: Sentiment = "neutral";
  let intentDelta = 0;

  if (has(text, NEGATIVE)) {
    intent = "not_interested";
    sentiment = "negative";
    intentDelta = -40;
  } else if (has(text, MEETING)) {
    intent = "meeting";
    sentiment = "positive";
    intentDelta = 30;
  } else if (has(text, POSITIVE)) {
    intent = "interested";
    sentiment = "positive";
    intentDelta = 20;
  } else if (isQuestion) {
    intent = "question";
    intentDelta = 5;
  } else if (/\b(but|however|concern|worried|not sure|expensive|already (use|have))\b/.test(text)) {
    intent = "objection";
    sentiment = "negative";
    intentDelta = -10;
  } else if (text.length < 25) {
    intent = "smalltalk";
  }

  const topic = factual
    ? (FACTUAL_KEYWORDS.find((k) => text.includes(k)) ?? "general")
    : intent;
  const hasNewInfo = intent !== "smalltalk" && tokens(text) >= 3;

  return { intent, sentiment, isQuestion, isFactualQuestion: factual, hasNewInfo, topic, intentDelta };
}

function tokens(text: string): number {
  return (text.match(/[a-z0-9]+/g) ?? []).length;
}

/**
 * Decide the turn action from the classification and whether grounding exists.
 * The grounding guard: a factual question with no relevant chunk ALWAYS escalates
 * (never invent a fact).
 */
export function decideAction(c: Classification, hasRelevantChunk: boolean): TurnAction {
  if (c.intent === "not_interested") return "escalate";
  if (c.isFactualQuestion && !hasRelevantChunk) return "escalate"; // grounding guard
  if (c.isFactualQuestion) return "answer";
  if (c.intent === "meeting" || c.intent === "interested") return "cta";
  if (c.intent === "objection") return "objection";
  if (c.isQuestion) return hasRelevantChunk ? "answer" : "qualify";
  return "nurture";
}
