import assert from "node:assert/strict";
import { test } from "node:test";

import { aboveTheFold, auditAccountProfile, lintMessage, lintMessageBody } from "./guardrails";
import { COMMUNITY_PROMPTS, resolvePromptTemplate, varietyWarning } from "./prompts";
import {
  extractAiPrompt,
  isBodyConfigured,
  legacyToMessageBody,
  messageBodyToTemplate,
  readMessageBody,
  renderMessageBody,
} from "./render";
import type { MessageBody } from "./segments";

// --- fallback / skip-on-empty (the no-broken-merge guarantee) ---------------

test("renderMessageBody drops an empty variable with no fallback and repairs punctuation", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name" },
      { type: "text", text: ", welcome" },
    ],
  };
  // No first_name → segment dropped, "Hi , welcome" collapses to "Hi, welcome".
  assert.equal(renderMessageBody(body, {}), "Hi, welcome");
  assert.equal(renderMessageBody(body, { first_name: "Jane" }), "Hi Jane, welcome");
});

test("renderMessageBody uses the fallback when the variable is empty", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: "!" },
    ],
  };
  assert.equal(renderMessageBody(body, {}), "Hi there!");
  assert.equal(renderMessageBody(body, { first_name: "Sam" }), "Hi Sam!");
});

test("renderMessageBody never emits a broken trailing merge", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "saw you're doing " },
      { type: "variable", key: "company_overview" },
    ],
  };
  assert.equal(renderMessageBody(body, {}), "saw you're doing");
});

test("renderMessageBody collapses interior double spaces from a dropped middle segment", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "A " },
      { type: "variable", key: "x" },
      { type: "text", text: " B" },
    ],
  };
  assert.equal(renderMessageBody(body, {}), "A B");
});

test("renderMessageBody preserves intentional paragraph breaks", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Line one\n\nLine two for " },
      { type: "variable", key: "first_name", fallback: "you" },
    ],
  };
  assert.equal(renderMessageBody(body, {}), "Line one\n\nLine two for you");
  assert.equal(renderMessageBody(body, { first_name: "Jane" }), "Line one\n\nLine two for Jane");
});

// --- AI segments ------------------------------------------------------------

test("renderMessageBody renders AI segments via renderAi and drops them without a resolver", () => {
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hey, " },
      { type: "ai", prompt: "observation" },
    ],
  };
  assert.equal(renderMessageBody(body, {}), "Hey,");
  assert.equal(
    renderMessageBody(body, {}, { renderAi: () => "saw your launch" }),
    "Hey, saw your launch",
  );
});

// --- legacy round-trip ------------------------------------------------------

test("legacyToMessageBody parses {token} templates and aiPrompt into segments", () => {
  const body = legacyToMessageBody("Hi {first_name} at {company}", "be warm");
  assert.deepEqual(body.segments, [
    { type: "text", text: "Hi " },
    { type: "variable", key: "first_name" },
    { type: "text", text: " at " },
    { type: "variable", key: "company" },
    { type: "ai", prompt: "be warm" },
  ]);
});

test("messageBodyToTemplate is the inverse of legacyToMessageBody for the text/variable parts", () => {
  const template = "Hi {first_name}, how is {company}?";
  assert.equal(messageBodyToTemplate(legacyToMessageBody(template)), template);
});

test("extractAiPrompt returns the first AI prompt", () => {
  assert.equal(extractAiPrompt(legacyToMessageBody("x", "do the thing")), "do the thing");
  assert.equal(extractAiPrompt(legacyToMessageBody("x")), undefined);
});

// --- readMessageBody --------------------------------------------------------

test("readMessageBody prefers structured messageBody over legacy keys", () => {
  const structured: MessageBody = { v: 1, segments: [{ type: "text", text: "structured" }] };
  const out = readMessageBody({ messageBody: structured, body: "legacy {first_name}" });
  assert.deepEqual(out.segments, structured.segments);
});

test("readMessageBody falls back to legacy keys (and honors custom legacy key order)", () => {
  const fromBody = readMessageBody({ body: "Hi {first_name}" });
  assert.equal(messageBodyToTemplate(fromBody), "Hi {first_name}");
  const fromText = readMessageBody({ text: "Nice {company}" }, ["text", "comment", "body"]);
  assert.equal(messageBodyToTemplate(fromText), "Nice {company}");
});

// --- isBodyConfigured -------------------------------------------------------

test("isBodyConfigured reflects whether the body has meaningful content", () => {
  assert.equal(isBodyConfigured(undefined), false);
  assert.equal(isBodyConfigured({ v: 1, segments: [] }), false);
  assert.equal(isBodyConfigured({ v: 1, segments: [{ type: "text", text: "   " }] }), false);
  assert.equal(isBodyConfigured({ v: 1, segments: [{ type: "text", text: "hi" }] }), true);
  assert.equal(isBodyConfigured({ v: 1, segments: [{ type: "variable", key: "first_name" }] }), true);
  assert.equal(isBodyConfigured({ v: 1, segments: [{ type: "ai", prompt: "x" }] }), true);
});

// --- prompt template + variety (E2) -----------------------------------------

test("COMMUNITY_PROMPTS are well-formed and uniquely namespaced", () => {
  const refs = new Set<string>();
  for (const c of COMMUNITY_PROMPTS) {
    assert.ok(c.ref.startsWith("community:"), `ref must be namespaced: ${c.ref}`);
    assert.ok(!refs.has(c.ref), `duplicate ref: ${c.ref}`);
    refs.add(c.ref);
    assert.ok(c.title.trim().length > 0, `empty title: ${c.ref}`);
    assert.ok(c.template.trim().length > 0, `empty template: ${c.ref}`);
    assert.equal(c.readOnly, true);
    assert.equal(c.author, "10xConnect");
  }
  // 4 original + the profile-scanning additions.
  assert.ok(COMMUNITY_PROMPTS.length >= 10, "expected an expanded curated library");
});

test("resolvePromptTemplate fills {{Label}} and {{key}} tokens, dropping empties", () => {
  const vars = { headline: "Head of Growth", company: "Acme", role: "Head of Growth" };
  assert.equal(
    resolvePromptTemplate("about {{Headline}} at {{Company name}}", vars),
    "about Head of Growth at Acme",
  );
  // {{Job title}} → role; {{Biography}} empty → dropped, whitespace collapsed.
  assert.equal(resolvePromptTemplate("{{Job title}} {{Biography}}", vars), "Head of Growth");
});

test("varietyWarning flags identical and near-identical outputs, passes distinct ones", () => {
  assert.equal(varietyWarning(["only one"]), null);
  assert.match(varietyWarning(["same line", "same line", "same line"]) ?? "", /copy-paste/);
  assert.equal(
    varietyWarning([
      "saw you're scaling fintech in berlin",
      "love your work on supply chain logistics",
      "noticed your push into healthcare analytics",
    ]),
    null,
  );
  assert.match(
    varietyWarning([
      "saw you are scaling the team quickly",
      "saw you are scaling the team fast",
      "saw you are scaling the team now",
    ]) ?? "",
    /similar/,
  );
});

// --- methodology guardrails (E3) --------------------------------------------

test("lintMessage flags salesy phrases, hard CTAs, links, and over-length", () => {
  const clean = lintMessage("Hi Jane, saw your work in fintech — what's your focus this quarter?");
  assert.equal(clean.length, 0);

  const ids = (text: string, opts = {}): string[] => lintMessage(text, opts).map((f) => f.id);
  assert.ok(ids("Check out our cutting-edge platform").includes("salesy"));
  assert.ok(ids("Want to book a call this week?").includes("hard_cta"));
  assert.ok(ids("See https://acme.com for details", { firstTouch: true }).includes("link"));
  assert.ok(ids(`word ${"more ".repeat(60)}`).includes("length"));
});

test("lintMessageBody (the composer's live pipeline) fires on a bad structured message", () => {
  // A salesy, link-bearing body with a hard CTA — exactly what the composer panel
  // lints on every keystroke (renders body → lints the rendered text).
  const bad: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: ", check out our cutting-edge platform at https://acme.com — book a call?" },
    ],
  };
  const ids = lintMessageBody(bad, { firstTouch: true }).map((f) => f.id);
  assert.ok(ids.includes("salesy"), "salesy phrase flagged");
  assert.ok(ids.includes("hard_cta"), "hard CTA flagged");
  assert.ok(ids.includes("link"), "first-touch link flagged");

  // A clean conversational body produces no findings (linter doesn't cry wolf).
  const good: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: ", saw your work in fintech — what's your focus this quarter?" },
    ],
  };
  assert.equal(lintMessageBody(good).length, 0);

  // An empty body is silent (no false warnings before the user types).
  assert.equal(lintMessageBody({ v: 1, segments: [] }).length, 0);
});

test("aboveTheFold returns the visible portion and a truncation flag", () => {
  const short = aboveTheFold("Hi there, quick question");
  assert.equal(short.truncated, false);
  const long = aboveTheFold("x".repeat(300));
  assert.equal(long.truncated, true);
  assert.ok(long.visible.endsWith("…"));
});

test("auditAccountProfile warns on sales headline + inactive status, advises when unknown", () => {
  const warns = auditAccountProfile({ headline: "SDR at Acme", status: "paused", hasPhoto: false });
  const ids = warns.map((w) => w.id);
  assert.ok(ids.includes("headline"));
  assert.ok(ids.includes("status"));
  assert.ok(ids.includes("photo"));
  // Unknown data → advisory info, never a false pass.
  const unknown = auditAccountProfile({ status: "active" });
  assert.ok(unknown.every((i) => i.severity !== "warn"));
  assert.ok(unknown.some((i) => i.id === "photo" && i.severity === "info"));
});
