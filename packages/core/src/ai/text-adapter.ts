// AI text-generation boundary (CLAUDE.md §5 — provider SDKs live in
// packages/adapters; this is the pure interface the app/engine depend on). The
// personalization engine builds a prompt from a lead's profile + the user's
// editable instructions; an implementation (Gemini for the MVP) generates text.

export interface TextGenerationInput {
  /** The main instruction/prompt. */
  prompt: string;
  /** Optional system/role priming. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Token accounting for one LLM call (Phase 3 metering). */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** A generation result that carries real provider token usage when available. */
export interface TextGenerationResult {
  text: string;
  /** Provider-reported usage; absent → the metering layer estimates from text. */
  usage?: TokenUsage;
}

export interface TextGenerationAdapter {
  /** Generate a short text completion. Implementations map provider errors to throws. */
  generate(input: TextGenerationInput): Promise<string>;
  /**
   * Optional: generate AND return provider token usage (Phase 3 metering). When a
   * provider exposes usage (e.g. Gemini usageMetadata) implement this so spend is
   * metered accurately; the metering wrapper falls back to estimating from text.
   */
  generateWithUsage?(input: TextGenerationInput): Promise<TextGenerationResult>;
}

/** Lead facts the personalization prompt can reference. */
export interface PersonalizationProfile {
  firstName?: string;
  lastName?: string;
  headline?: string;
  about?: string;
  company?: string;
  companyOverview?: string;
  role?: string;
  seniority?: string;
  industry?: string;
  location?: string;
  /** Most-recent-first post texts — the strongest "what they're up to" signal. */
  recentPosts?: string[];
}

const SYSTEM_PROMPT =
  "You write first-line observations and short outreach messages for B2B LinkedIn outreach. " +
  "Rules: be specific to THIS person — prefer referencing their recent posts or current focus over generic facts. " +
  "Never salesy, no pitching. Prefer a genuine observation plus a soft, low-friction question. " +
  "Keep it to 1-2 sentences. Output ONLY the message text — no preamble, no quotes. " +
  // Phase 5: empty-bracket output must be impossible — write only from real facts.
  "Use ONLY the prospect facts provided. If there is no recent activity, personalize from their role and company instead. " +
  "If you lack a specific detail, write a natural sentence without it — NEVER output a placeholder, bracket, blank, or the word 'undefined'.";

/** How many recent posts to surface to the model (most-recent-first). */
const MAX_RECENT_POSTS = 3;

/** Build the personalization prompt for one lead from editable instructions. */
export function buildPersonalizationPrompt(
  instructions: string,
  profile: PersonalizationProfile,
): TextGenerationInput {
  const posts = (profile.recentPosts ?? [])
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .slice(0, MAX_RECENT_POSTS);
  const recentPosts =
    posts.length > 0
      ? `Recent posts:\n${posts.map((p) => `- ${truncate(p, 300)}`).join("\n")}`
      : undefined;

  const facts = [
    profile.firstName && `First name: ${profile.firstName}`,
    profile.role && `Role: ${profile.role}`,
    profile.seniority && `Seniority: ${profile.seniority}`,
    profile.company && `Company: ${profile.company}`,
    profile.industry && `Industry: ${profile.industry}`,
    profile.companyOverview && `Company overview: ${truncate(profile.companyOverview, 300)}`,
    profile.headline && `Headline: ${profile.headline}`,
    profile.location && `Location: ${profile.location}`,
    profile.about && `About: ${truncate(profile.about, 400)}`,
    recentPosts,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `${instructions.trim()}\n\nProspect details:\n${facts || "(limited details available)"}`;
  return { prompt, system: SYSTEM_PROMPT, maxTokens: 200, temperature: 0.7 };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * True if a profile carries any fact worth personalizing from (beyond a bare
 * name). When false, the AI has nothing to work with — skip the call entirely
 * rather than let the model emit a meta-complaint ("No prospect details provided").
 */
export function hasPersonalizationSignal(profile: PersonalizationProfile): boolean {
  return Boolean(
    profile.headline ||
      profile.about ||
      profile.company ||
      profile.companyOverview ||
      profile.role ||
      profile.seniority ||
      profile.industry ||
      (profile.recentPosts && profile.recentPosts.length > 0),
  );
}

// LLM refusal / meta-commentary openers. When a model is given too little to work
// with it tends to explain itself instead of writing the line — that text must
// NEVER be sent. Anchored to the START of the (trimmed) output.
const REFUSAL_RE =
  /^(i\s+(cannot|can'?t|can not|am unable|couldn'?t|could not|don'?t have|do not have)|i'?m\s+(sorry|unable|not able)|no\s+(prospect|profile|information|details|specific)|please\s+provide|unable to|as an ai|i need more|there (is|are) no|without (the|more|any|enough)|sorry,? )/i;

/** Detect an LLM refusal / "I can't do this" output so the AI segment is dropped. */
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return true;
  }
  return REFUSAL_RE.test(t);
}
