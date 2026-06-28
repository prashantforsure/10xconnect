// Canned "are you AI?" disclosure (Phase 4). When a prospect asks whether they're
// talking to a bot we return a fixed, HONEST answer — we never let the model
// improvise (and never let it deny being AI-assisted). Responsible posture per
// CLAUDE.md §2: be honest about automation. Detection + copy are pure + testable.

const AI_IDENTITY_PATTERNS = [
  "are you a bot",
  "are you a robot",
  "are you ai",
  "are you an ai",
  "is this ai",
  "is this a bot",
  "is this a robot",
  "are you human",
  "are you a human",
  "are you a real person",
  "are you real",
  "am i talking to a real",
  "am i talking to a person",
  "am i talking to a human",
  "is this automated",
  "are you automated",
  "are you a chatbot",
  "is this a real person",
  "is this an actual person",
  "talking to a bot",
  "speaking to a bot",
  "this a bot",
];

/** The ONE honest reply to "are you AI?" — pre-vetted; never generated. */
export const AI_IDENTITY_RESPONSE =
  "Good question — I do use an AI assistant to help me keep up with messages, " +
  "but there's a real person (me) reading every reply, and I jump in personally " +
  "whenever it matters. Happy to hop on a quick call if that's easier.";

/** Does the message ask whether they're talking to a bot/AI/human? */
export function detectAiIdentityQuestion(message: string): boolean {
  const t = (message ?? "").toLowerCase();
  return AI_IDENTITY_PATTERNS.some((p) => t.includes(p));
}
