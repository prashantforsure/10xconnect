import assert from "node:assert/strict";
import { test } from "node:test";

import { isSalesNavigatorSearchUrl, parseSalesNavigatorSearchUrl } from "./sales-nav";

test("parseSalesNavigatorSearchUrl accepts real Sales Nav search URLs", () => {
  const people = parseSalesNavigatorSearchUrl(
    "https://www.linkedin.com/sales/search/people?query=(keywords:head%20of%20growth)&sessionId=abc",
  );
  assert.ok(people);
  assert.equal(people!.surface, "people");
  assert.equal(people!.keywords, "head of growth");

  const simple = parseSalesNavigatorSearchUrl("https://www.linkedin.com/sales/search/people?keywords=revops");
  assert.equal(simple?.keywords, "revops");

  const company = parseSalesNavigatorSearchUrl("https://linkedin.com/sales/search/company?query=(x:y)");
  assert.equal(company?.surface, "company");
});

test("isSalesNavigatorSearchUrl REJECTS profile / feed / junk URLs", () => {
  assert.equal(isSalesNavigatorSearchUrl("https://www.linkedin.com/in/jane-doe"), false, "profile url");
  assert.equal(isSalesNavigatorSearchUrl("https://www.linkedin.com/search/results/people/?keywords=x"), false, "regular search");
  assert.equal(isSalesNavigatorSearchUrl("https://www.linkedin.com/feed/"), false, "feed");
  assert.equal(isSalesNavigatorSearchUrl("https://evil.com/sales/search/people"), false, "non-linkedin host");
  assert.equal(isSalesNavigatorSearchUrl("not a url"), false);
  assert.equal(isSalesNavigatorSearchUrl(""), false);
  assert.equal(isSalesNavigatorSearchUrl(undefined), false);
});

test("normalizedUrl keeps the query + lowercases the host", () => {
  const r = parseSalesNavigatorSearchUrl("https://WWW.LinkedIn.com/sales/search/people?keywords=ceo");
  assert.equal(r?.normalizedUrl, "https://www.linkedin.com/sales/search/people?keywords=ceo");
});
