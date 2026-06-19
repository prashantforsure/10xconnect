// Deterministic mock implementation of TextGenerationAdapter. Used in dev/test
// (ADAPTER=mock or LLM_PROVIDER=mock) so AI personalization + the campaign
// generator work with NO LLM key — the whole stack stays mock-safe (CLAUDE.md §3).
// It produces SHORT, VARIED, per-lead output so previews look distinct and the
// variety check passes; identical inputs yield identical output (deterministic).

import type { TextGenerationAdapter, TextGenerationInput } from "@10xconnect/core";

const OPENERS = [
  "saw you're scaling",
  "noticed your work on",
  "love what you're building at",
  "impressed by your push into",
  "caught your recent move in",
  "your focus on",
  "been following your work in",
  "great to see momentum at",
];

// Used when a recent post is available, so mock previews reflect activity.
const POST_OPENERS = [
  "saw your recent post —",
  "caught your note on this —",
  "your take here landed —",
  "interesting post —",
];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Pull a labelled fact ("Company: Acme") out of the built personalization prompt. */
function fact(prompt: string, label: string): string | undefined {
  const m = new RegExp(`${label}:\\s*(.+)`, "i").exec(prompt);
  return m?.[1]?.split("\n")[0]?.trim() || undefined;
}

/** Recent-post bullet lines from the "Recent posts:" facts block. */
function recentPosts(prompt: string): string[] {
  return prompt
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/** First clause of a post, lowercased, capped to a short fragment. */
function postSnippet(post: string): string {
  return post
    .toLowerCase()
    .replace(/[.!?—].*$/, "")
    .split(/\s+/)
    .slice(0, 9)
    .join(" ")
    .trim();
}

export class MockTextAdapter implements TextGenerationAdapter {
  generate(input: TextGenerationInput): Promise<string> {
    const p = input.prompt;
    const company = fact(p, "Company");
    const role = fact(p, "Role");
    const headline = fact(p, "Headline");
    const first = fact(p, "First name");
    const seed = hash(`${first ?? ""}|${company ?? ""}|${role ?? ""}|${headline ?? ""}`);

    // Prefer reacting to a (seed-selected) recent post so output reads like the
    // sender actually scanned their activity. Falls back to role/company facts.
    const posts = recentPosts(p);
    if (posts.length > 0) {
      const post = posts[seed % posts.length];
      const opener = POST_OPENERS[seed % POST_OPENERS.length];
      const out = `${opener} ${postSnippet(post)}`.replace(/\s+/g, " ").trim();
      if (out.length > opener.length + 1) {
        return Promise.resolve(out);
      }
    }

    const topic = company ?? role ?? headline ?? first ?? "your space";
    const opener = OPENERS[seed % OPENERS.length];
    // Keep it short, lowercase, no hard pitch — matches the methodology defaults.
    return Promise.resolve(`${opener} ${topic.toLowerCase()}`.replace(/\s+/g, " ").trim());
  }
}
