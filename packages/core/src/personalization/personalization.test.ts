// Pure unit tests for Phase 5 personalization: the variable resolver (fallback /
// freshness / on_missing), the skip_sentence renderer (no empty brackets), and the
// prompt-version hash (cache invalidation key).

import assert from "node:assert/strict";
import { test } from "node:test";

import { hasPersonalizationSignal, looksLikeRefusal } from "../ai/text-adapter";
import { renderMessageBody } from "../composer/render";
import type { MessageBody } from "../composer/segments";

import { resolveContactVariables } from "./resolver";
import { promptVersion } from "./version";

test("resolver fills values, applies fallbacks, and exposes available/missing", () => {
  const r = resolveContactVariables({ enrichment: { firstName: "Dana", company: "Acme" }, customColumns: {} });
  assert.equal(r.values.firstName, "Dana");
  assert.equal(r.values.companyName, "Acme");
  assert.equal(r.values.first_name, "Dana", "legacy snake_case alias resolves");
  assert.equal(r.values.company, "Acme");
  assert.equal(r.values.jobTitle, "your role", "missing jobTitle uses its fallback");
  assert.equal(r.values.lastPost, "", "missing activity is blank (renderer drops it)");
  assert.equal(r.policy.lastPost, "skip_sentence");
  assert.ok(r.available.includes("firstName"));
  assert.ok(r.missing.includes("lastPost"));
});

test("empty firstName falls back to a safe greeting (never blank)", () => {
  const r = resolveContactVariables({ enrichment: {}, customColumns: {} });
  assert.equal(r.values.firstName, "there");
});

test("activity freshness: stale enrichment drops the activity value", () => {
  const enrichment = { lastPost: "shipped v2 this week" };
  const fresh = resolveContactVariables({ enrichment, customColumns: {}, enrichedAt: "2026-06-20T00:00:00Z", now: new Date("2026-06-28T00:00:00Z") });
  assert.equal(fresh.values.lastPost, "shipped v2 this week", "8 days old < 30d freshness");
  const stale = resolveContactVariables({ enrichment, customColumns: {}, enrichedAt: "2020-01-01T00:00:00Z", now: new Date("2026-06-28T00:00:00Z") });
  assert.equal(stale.values.lastPost, "", "stale activity is dropped");
});

test("skip_sentence: an empty post drops the whole sentence — NO empty brackets", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hey " },
      { type: "variable", key: "firstName" },
      { type: "text", text: ". Saw your recent post " },
      { type: "variable", key: "lastPost" },
      { type: "text", text: ". Worth a quick chat?" },
    ],
  };
  const r = resolveContactVariables({ enrichment: { firstName: "Dana" }, customColumns: {} });
  const out = renderMessageBody(body, r.values, { policyByKey: r.policy });
  assert.equal(out, "Hey Dana. Worth a quick chat?");
  assert.ok(!out.includes("{"), "no empty brackets");
  assert.ok(!out.toLowerCase().includes("saw your recent post"), "the post sentence was dropped");
});

test("custom columns resolve via custom:/customField: keys", () => {
  const r = resolveContactVariables({ enrichment: {}, customColumns: { signupDate: "March" } }, ["custom:signupDate"]);
  assert.equal(r.values["custom:signupDate"], "March");
});

test("AI guard: hasPersonalizationSignal needs a real fact beyond a name", () => {
  assert.equal(hasPersonalizationSignal({ firstName: "Harshit", lastName: "Patel" }), false);
  assert.equal(hasPersonalizationSignal({ firstName: "Dana", headline: "VP Sales at Acme" }), true);
  assert.equal(hasPersonalizationSignal({ company: "Acme" }), true);
  assert.equal(hasPersonalizationSignal({ recentPosts: ["shipped v2"] }), true);
  assert.equal(hasPersonalizationSignal({}), false);
});

test("AI guard: looksLikeRefusal catches model meta-complaints (never send them)", () => {
  assert.equal(looksLikeRefusal("No prospect details provided. Please provide prospect"), true);
  assert.equal(looksLikeRefusal("I cannot generate a specific message without the"), true);
  assert.equal(looksLikeRefusal("I'm sorry, I don't have enough information"), true);
  assert.equal(looksLikeRefusal("   "), true, "blank is a refusal");
  // A genuine personalized line is NOT a refusal.
  assert.equal(looksLikeRefusal("saw you're scaling the sales team fast"), false);
  assert.equal(looksLikeRefusal("congrats on the recent funding round"), false);
});

test("promptVersion changes when the body changes, stable otherwise", () => {
  const a: MessageBody = { v: 1, segments: [{ type: "ai", prompt: "write a hook" }] };
  const b: MessageBody = { v: 1, segments: [{ type: "ai", prompt: "write a DIFFERENT hook" }] };
  assert.notEqual(promptVersion(a), promptVersion(b));
  assert.equal(promptVersion(a), promptVersion({ v: 1, segments: [{ type: "ai", prompt: "write a hook" }] }));
});
