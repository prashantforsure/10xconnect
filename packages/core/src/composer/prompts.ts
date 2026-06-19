// AI prompt library primitives (CLAUDE.md §8). A prompt is a reusable template
// that references contact variables ({{Headline}}, {{Company Overview}}, …) plus
// instructions and outputs a short personalized segment. Pure + shared by the web
// library UI and the API generation path. The curated Community set lives in code
// (read-only); Saved + My Prompts are persisted per workspace.

import { VARIABLE_REGISTRY } from "./segments";

export interface PromptCard {
  /** Stable ref: "community:<slug>" for curated, "workspace:<uuid>" for saved. */
  ref: string;
  title: string;
  template: string;
  author: string;
  runCount: number;
  favorited?: boolean;
  /** True for the read-only curated set. */
  readOnly?: boolean;
}

// Curated, framework-correct starter prompts (the "start conversations, don't
// sell" methodology — §2). Read-only; users favorite or fork them into My Prompts.
export const COMMUNITY_PROMPTS: readonly PromptCard[] = [
  {
    ref: "community:saw-youre-doing-x",
    title: "Saw you're doing X",
    template:
      "Based on the following LinkedIn profile info, write a very short 4-8 word sentence " +
      "starting with \"saw you're doing X\". Replace X with info about the lead or its company, " +
      "casual and friendly, abbreviations ok. Don't reuse exact profile words. No punctuation, " +
      "no uppercase. Don't mention the company name.\n### {{Headline}} {{Biography}} {{Company Overview}}",
    author: "10xConnect",
    runCount: 8558,
    readOnly: true,
  },
  {
    ref: "community:genuine-observation",
    title: "Genuine observation + soft question",
    template:
      "Write one genuine, specific observation about this person's work, then a soft, " +
      "low-friction question. 1-2 short sentences. Never salesy, no pitching.\n" +
      "### {{Headline}} {{Biography}} {{Company Overview}}",
    author: "10xConnect",
    runCount: 4123,
    readOnly: true,
  },
  {
    ref: "community:role-relevant-hook",
    title: "Role-relevant hook",
    template:
      "In under 12 words, reference something relevant to a {{Job title}} at {{Company name}}. " +
      "Friendly, curious, lowercase ok. No links, no CTA.\n### {{Headline}} {{Biography}}",
    author: "10xConnect",
    runCount: 2076,
    readOnly: true,
  },
  {
    ref: "community:recent-work-compliment",
    title: "Recent work compliment",
    template:
      "Write a short, sincere compliment about this person's recent work or focus area. " +
      "Max 10 words, no exclamation marks, no pitch.\n### {{Headline}} {{Biography}}",
    author: "10xConnect",
    runCount: 1340,
    readOnly: true,
  },
];

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function normalizeKey(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, "_");
}

// label (lowercased, spaces→_) → variable key, e.g. "company_overview" stays,
// "job_title" → "role", "company_name" → "company".
const LABEL_TO_KEY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const v of VARIABLE_REGISTRY) {
    map[v.key] = v.key;
    map[normalizeKey(v.label)] = v.key;
  }
  return map;
})();

/**
 * Resolve {{Variable}} / {{variable_key}} tokens in a prompt template against a
 * lead's variable map. Unknown/empty tokens collapse to "" (a prompt is an
 * instruction to the LLM, so an empty fact is simply omitted).
 */
export function resolvePromptTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(TOKEN_RE, (_m, token: string) => {
      const key = LABEL_TO_KEY[normalizeKey(token)] ?? normalizeKey(token);
      return (vars[key] ?? "").trim();
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) {
      inter += 1;
    }
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Detect the "copy-paste smell": personalized outputs that are too similar across
 * leads. Returns a warning string when average pairwise similarity is high (or
 * there are exact duplicates), else null. Non-blocking — advisory only.
 */
export function varietyWarning(outputs: string[]): string | null {
  const cleaned = outputs.map((o) => o.trim()).filter(Boolean);
  if (cleaned.length < 2) {
    return null;
  }
  const unique = new Set(cleaned.map((o) => o.toLowerCase()));
  if (unique.size === 1) {
    return "Every lead got the same line — this reads as copy-paste. Add more profile variables or a sharper prompt.";
  }
  const tokens = cleaned.map(tokenize);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      sum += jaccard(tokens[i], tokens[j]);
      pairs += 1;
    }
  }
  const avg = pairs === 0 ? 0 : sum / pairs;
  if (avg >= 0.6) {
    return "Outputs look very similar across leads. Tweak the prompt or pull in more specific profile fields for real variety.";
  }
  return null;
}
