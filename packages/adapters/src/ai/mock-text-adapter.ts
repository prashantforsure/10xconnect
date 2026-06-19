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

export class MockTextAdapter implements TextGenerationAdapter {
  generate(input: TextGenerationInput): Promise<string> {
    const p = input.prompt;
    const company = fact(p, "Company");
    const role = fact(p, "Role");
    const headline = fact(p, "Headline");
    const first = fact(p, "First name");
    const topic = company ?? role ?? headline ?? first ?? "your space";
    const seed = hash(`${first ?? ""}|${company ?? ""}|${role ?? ""}|${headline ?? ""}`);
    const opener = OPENERS[seed % OPENERS.length];
    // Keep it short, lowercase, no hard pitch — matches the methodology defaults.
    return Promise.resolve(`${opener} ${topic.toLowerCase()}`.replace(/\s+/g, " ").trim());
  }
}
