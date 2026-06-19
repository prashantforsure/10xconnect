import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSearchRequest,
  extractPostActivityId,
  mapSearchItemToSourcedLead,
  searchApiForKind,
} from "./unipile-lead-source-mappers";

// --- search surface selection ----------------------------------------------

test("searchApiForKind selects sales_navigator only for that kind", () => {
  assert.equal(searchApiForKind("sales_navigator"), "sales_navigator");
  assert.equal(searchApiForKind("linkedin_search"), "classic");
  assert.equal(searchApiForKind("lead_finder"), "classic");
  assert.equal(searchApiForKind("event"), "classic");
  assert.equal(searchApiForKind("group"), "classic");
});

// --- request building -------------------------------------------------------

test("buildSearchRequest prefers a parsed search URL", () => {
  const req = buildSearchRequest({
    kind: "linkedin_search",
    url: "https://www.linkedin.com/search/results/people/?keywords=cto",
  });
  assert.deepEqual(req, {
    api: "classic",
    category: "people",
    url: "https://www.linkedin.com/search/results/people/?keywords=cto",
  });
});

test("buildSearchRequest folds lead_finder keywords + filters into one query", () => {
  const req = buildSearchRequest({
    kind: "lead_finder",
    keywords: "growth",
    filters: { title: "Head of Growth", company: "Acme", location: "London" },
  });
  assert.equal(req.api, "classic");
  assert.equal(req.url, undefined);
  assert.equal(req.keywords, "growth Head of Growth Acme London");
});

test("buildSearchRequest de-dupes repeated keyword fragments", () => {
  const req = buildSearchRequest({
    kind: "lead_finder",
    keywords: "fintech",
    filters: { keywords: "fintech", title: "CTO" },
  });
  assert.equal(req.keywords, "fintech CTO");
});

// --- item → SourcedLead -----------------------------------------------------

test("mapSearchItemToSourcedLead maps a classic people-search row", () => {
  const lead = mapSearchItemToSourcedLead({
    provider_id: "ACoAA123",
    public_identifier: "jane-doe",
    first_name: "Jane",
    last_name: "Doe",
    headline: "VP Sales at Acme",
    current_company: "Acme",
    occupation: "VP Sales",
    location: "San Francisco, CA",
    network_distance: "DISTANCE_2",
  });
  assert.deepEqual(lead, {
    linkedinUrl: "https://www.linkedin.com/in/jane-doe",
    providerId: "ACoAA123",
    firstName: "Jane",
    lastName: "Doe",
    headline: "VP Sales at Acme",
    company: "Acme",
    role: "VP Sales",
    location: "San Francisco, CA",
    connectionDegree: 2,
  });
});

test("mapSearchItemToSourcedLead splits a single `name` field and uses id fallback", () => {
  const lead = mapSearchItemToSourcedLead({
    id: "member-9",
    public_profile_url: "https://www.linkedin.com/in/ada-lovelace",
    name: "Ada Lovelace",
    network_distance: "FIRST_DEGREE",
  });
  assert.equal(lead?.firstName, "Ada");
  assert.equal(lead?.lastName, "Lovelace");
  assert.equal(lead?.providerId, "member-9");
  assert.equal(lead?.linkedinUrl, "https://www.linkedin.com/in/ada-lovelace");
  assert.equal(lead?.connectionDegree, 1);
});

test("mapSearchItemToSourcedLead reads the nested author on engagement rows", () => {
  const lead = mapSearchItemToSourcedLead({
    author: { provider_id: "ACoAB", public_identifier: "liker-1", name: "Sam" },
  });
  assert.equal(lead?.providerId, "ACoAB");
  assert.equal(lead?.firstName, "Sam");
  assert.equal(lead?.linkedinUrl, "https://www.linkedin.com/in/liker-1");
});

test("mapSearchItemToSourcedLead drops rows with no usable identifier", () => {
  assert.equal(mapSearchItemToSourcedLead({ name: "No Identifier" }), undefined);
  assert.equal(mapSearchItemToSourcedLead({}), undefined);
});

// --- post id extraction -----------------------------------------------------

test("extractPostActivityId pulls the id from feed URLs and bare urns", () => {
  assert.equal(
    extractPostActivityId("https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/"),
    "7212345678901234567",
  );
  assert.equal(extractPostActivityId("urn:li:share:7000000000000000001"), "7000000000000000001");
  assert.equal(
    extractPostActivityId("https://www.linkedin.com/posts/jane_some-slug-activity-7212345678901234567-abcd"),
    "7212345678901234567",
  );
  assert.equal(extractPostActivityId("https://www.linkedin.com/feed/"), undefined);
});
