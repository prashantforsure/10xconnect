import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPersonalizationPrompt } from "./text-adapter";

test("buildPersonalizationPrompt surfaces multiple recent posts + company overview", () => {
  const { prompt, system } = buildPersonalizationPrompt("react to their work", {
    firstName: "Jordan",
    role: "Head of Growth",
    company: "Northwind",
    companyOverview: "B2B activation tooling for PLG teams",
    recentPosts: [
      "shipped a new onboarding flow",
      "hiring two growth engineers",
      "hot take on activation copy",
    ],
  });
  assert.match(prompt, /Recent posts:/);
  assert.match(prompt, /- shipped a new onboarding flow/);
  assert.match(prompt, /- hiring two growth engineers/);
  assert.match(prompt, /Company overview: B2B activation tooling/);
  assert.ok(system && system.length > 0);
});

test("buildPersonalizationPrompt caps recent posts at 3 and drops empties", () => {
  const { prompt } = buildPersonalizationPrompt("x", {
    recentPosts: ["one", "two", "three", "four", "   "],
  });
  assert.match(prompt, /- one/);
  assert.match(prompt, /- three/);
  assert.doesNotMatch(prompt, /- four/);
});

test("buildPersonalizationPrompt omits absent fields", () => {
  const { prompt } = buildPersonalizationPrompt("x", { firstName: "Sam" });
  assert.doesNotMatch(prompt, /Recent posts:/);
  assert.doesNotMatch(prompt, /Company overview:/);
  assert.match(prompt, /First name: Sam/);
});
