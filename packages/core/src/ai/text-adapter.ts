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

export interface TextGenerationAdapter {
  /** Generate a short text completion. Implementations map provider errors to throws. */
  generate(input: TextGenerationInput): Promise<string>;
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
  location?: string;
  /** Most-recent-first post texts — the strongest "what they're up to" signal. */
  recentPosts?: string[];
}

const SYSTEM_PROMPT =
  "You write first-line observations and short outreach messages for B2B LinkedIn outreach. " +
  "Rules: be specific to THIS person — prefer referencing their recent posts or current focus over generic facts. " +
  "Never salesy, no pitching. Prefer a genuine observation plus a soft, low-friction question. " +
  "Keep it to 1-2 sentences. Output ONLY the message text — no preamble, no quotes.";

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
    profile.company && `Company: ${profile.company}`,
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
