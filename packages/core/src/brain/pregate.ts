// Conversation PRE-GATE (pure) — Phase 3 anti-spam. Runs BEFORE any model call
// (no classify, no retrieval, no draft) and short-circuits trash / closed /
// over-limit / opt-out conversations with ZERO LLM spend. This is the cheapest
// tier of the cost ladder: most "thanks!" / out-of-office / loop replies never
// reach the expensive reasoning model at all.
//
// It is IO-free: the engine loads state, calls evaluatePreGate, and performs any
// side effects (escalate, add to do_not_contact, set do_not_reply) for the
// returned disposition.

export type PreGateDisposition =
  | "allow" // proceed to classify → retrieve → draft
  | "skip" // no draft, no LLM; thread stays flagged for a human (trash/cooldown/closed)
  | "handoff" // forced human takeover (turn cap hit) → escalate, no LLM
  | "stop"; // hard stop: opt-out / loop → escalate + (engine) suppress / do_not_reply

export interface PreGateDecision {
  disposition: PreGateDisposition;
  /** Stable reason code (also the escalation reason surfaced in the inbox). */
  reason:
    | "ok"
    | "do_not_reply"
    | "closed"
    | "max_turns"
    | "cooldown"
    | "already_answered"
    | "out_of_office"
    | "low_signal"
    | "loop"
    | "not_interested"
    | "unsubscribe";
}

export interface PreGateInput {
  /** The prospect's latest inbound message (the one we'd answer). */
  message: string;
  /** relationship_state.do_not_reply — human muted the AI on this thread. */
  doNotReply: boolean;
  /** relationship_state.ai_turn_count — AI replies already sent. */
  aiTurnCount: number;
  /** relationship_state.last_ai_reply_at (ISO) — for the cooldown. */
  lastAiReplyAt: string | null;
  /** conversations.pipeline_stage. */
  pipelineStage: string | null;
  /** relationship_state.stage. */
  relationshipStage: string | null;
  /** Sent message counts in the thread (drafts don't count — only delivered). */
  inboundCount: number;
  outboundCount: number;
  /** Recent inbound bodies, most-recent-first (for loop/auto-responder detection). */
  recentInbound: string[];
  /** Campaign limits. */
  maxAiTurns: number;
  cooldownMinutes: number;
  /** Injected clock for deterministic tests. */
  now: Date;
}

const CLOSED_PIPELINE = new Set(["booked", "lost"]);
const CLOSED_RELATIONSHIP = new Set(["closed_won", "closed_lost"]);

// Auto-responder / out-of-office signatures (no real human on the other end).
const OUT_OF_OFFICE = [
  "out of office",
  "out of the office",
  "on vacation",
  "on holiday",
  "annual leave",
  "parental leave",
  "maternity leave",
  "away from my desk",
  "currently away",
  "limited access to email",
  "auto-reply",
  "automatic reply",
  "autoresponder",
  "i am away",
  "i'm away",
  "will be back on",
  "return to the office",
];

// Pure acknowledgements that don't warrant an AI reply (low signal).
const ACK_ONLY = new Set([
  "thanks",
  "thank you",
  "thank you!",
  "thanks!",
  "thx",
  "ty",
  "cheers",
  "great",
  "great!",
  "ok",
  "okay",
  "k",
  "got it",
  "sounds good",
  "perfect",
  "awesome",
  "👍",
  "🙏",
  "👌",
  "🔥",
]);

const UNSUBSCRIBE = [
  "unsubscribe",
  "opt out",
  "opt-out",
  "remove me",
  "take me off",
  "stop contacting",
  "stop messaging",
  "do not contact",
  "don't contact",
  "leave me alone",
  "gdpr",
];

const NOT_INTERESTED = [
  "not interested",
  "no thanks",
  "no thank you",
  "not a fit",
  "no longer interested",
  "please stop",
  "not right now and never",
];

function norm(text: string): string {
  return (text ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}
function has(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}
function stripPunct(text: string): string {
  return text.replace(/[!.?,;:]+$/g, "").trim();
}

/** Is the message just an emoji / one-word acknowledgement? */
function isLowSignal(normalized: string): boolean {
  const bare = stripPunct(normalized);
  if (ACK_ONLY.has(bare) || ACK_ONLY.has(normalized)) return true;
  // Emoji-only (no letters/digits).
  if (bare.length > 0 && !/[a-z0-9]/.test(bare)) return true;
  // Very short with no question and only an ack word.
  const words = bare.split(" ").filter(Boolean);
  return words.length <= 2 && words.every((w) => ACK_ONLY.has(w)) && !normalized.includes("?");
}

/**
 * Decide whether a conversation turn should proceed to the model. Order matters:
 * opt-out / hard-stop and turn-cap take precedence over "trash" skips so we never
 * silently ignore a "stop contacting me".
 */
export function evaluatePreGate(input: PreGateInput): PreGateDecision {
  const message = norm(input.message);

  // 1. Explicit opt-out — strongest signal. Suppress + hand to a human.
  if (has(message, UNSUBSCRIBE)) return { disposition: "stop", reason: "unsubscribe" };
  if (has(message, NOT_INTERESTED)) return { disposition: "stop", reason: "not_interested" };

  // 2. Human muted the AI / lead is suppressed on this thread.
  if (input.doNotReply) return { disposition: "skip", reason: "do_not_reply" };

  // 3. Thread is closed (won/lost or booked) — nothing to draft.
  if (
    (input.pipelineStage && CLOSED_PIPELINE.has(input.pipelineStage)) ||
    (input.relationshipStage && CLOSED_RELATIONSHIP.has(input.relationshipStage))
  ) {
    return { disposition: "skip", reason: "closed" };
  }

  // 4. Loop / auto-responder: the same inbound text repeating → stop + escalate.
  if (isLoop(input.recentInbound)) return { disposition: "stop", reason: "loop" };
  if (has(message, OUT_OF_OFFICE)) return { disposition: "skip", reason: "out_of_office" };

  // 5. Turn cap reached → forced human handoff (escalate, no LLM).
  if (input.aiTurnCount >= input.maxAiTurns) return { disposition: "handoff", reason: "max_turns" };

  // 6. One outbound per inbound — already answered (no new inbound to reply to).
  if (input.outboundCount >= input.inboundCount && input.inboundCount > 0) {
    return { disposition: "skip", reason: "already_answered" };
  }

  // 7. Per-contact cooldown (min minutes between AI replies).
  if (input.cooldownMinutes > 0 && input.lastAiReplyAt) {
    const elapsedMs = input.now.getTime() - new Date(input.lastAiReplyAt).getTime();
    if (elapsedMs >= 0 && elapsedMs < input.cooldownMinutes * 60_000) {
      return { disposition: "skip", reason: "cooldown" };
    }
  }

  // 8. Low-signal acknowledgement ("thanks!" / emoji) — not worth a reply.
  if (isLowSignal(message)) return { disposition: "skip", reason: "low_signal" };

  return { disposition: "allow", reason: "ok" };
}

/** Two of the last three inbound messages identical → an auto-responder loop. */
function isLoop(recentInbound: string[]): boolean {
  const recent = recentInbound.slice(0, 3).map((m) => stripPunct(norm(m))).filter(Boolean);
  if (recent.length < 2) return false;
  for (let i = 0; i < recent.length; i += 1) {
    for (let j = i + 1; j < recent.length; j += 1) {
      if (recent[i].length >= 4 && recent[i] === recent[j]) return true;
    }
  }
  return false;
}
