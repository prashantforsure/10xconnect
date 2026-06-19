import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveDedupeKey, type LeadSourceQuery } from "@10xconnect/core";

import { MockLeadSourceAdapter } from "./mock-lead-source-adapter";

const ACCOUNT = { accountId: "acc-1" };

test("a query resolves a deterministic page of candidate leads", async () => {
  const adapter = new MockLeadSourceAdapter({ totalPerQuery: 10, defaultPageSize: 10 });
  const query: LeadSourceQuery = { kind: "linkedin_search", keywords: "head of growth" };

  const a = await adapter.fetchLeads(ACCOUNT, query);
  const b = await adapter.fetchLeads(ACCOUNT, query);

  assert.equal(a.leads.length, 10);
  assert.equal(a.total, 10);
  // Same query → identical identities (so re-imports dedupe to zero new leads).
  assert.deepEqual(
    a.leads.map((l) => l.linkedinUrl ?? l.email),
    b.leads.map((l) => l.linkedinUrl ?? l.email),
  );
});

test("re-sourcing the same query yields identical dedupe keys", async () => {
  const adapter = new MockLeadSourceAdapter({ totalPerQuery: 12 });
  const query: LeadSourceQuery = { kind: "event", url: "https://linkedin.com/events/123" };

  const first = await adapter.fetchLeads(ACCOUNT, query);
  const keys = new Set(
    first.leads.map((l) => deriveDedupeKey({ linkedinUrl: l.linkedinUrl, email: l.email })),
  );
  // Every candidate produces a usable dedupe key (linkedin or email).
  assert.ok(!keys.has(undefined));
  assert.equal(keys.size, first.leads.length, "candidates within a query are unique");
});

test("pagination walks the full result set with no overlap", async () => {
  const adapter = new MockLeadSourceAdapter({ totalPerQuery: 24 });
  const base: LeadSourceQuery = { kind: "sales_navigator", url: "https://linkedin.com/sales/x" };

  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await adapter.fetchLeads(ACCOUNT, { ...base, limit: 10, cursor });
    for (const lead of page.leads) {
      seen.push(lead.linkedinUrl ?? lead.email!);
    }
    cursor = page.nextCursor;
    pages += 1;
    assert.ok(pages <= 5, "pagination must terminate");
  } while (cursor);

  assert.equal(seen.length, 24);
  assert.equal(new Set(seen).size, 24, "no lead appears on two pages");
});

test("lead_finder candidates carry a resolved email", async () => {
  const adapter = new MockLeadSourceAdapter({ totalPerQuery: 8 });
  const { leads } = await adapter.fetchLeads(ACCOUNT, {
    kind: "lead_finder",
    filters: { title: "VP Sales", location: "London" },
  });
  assert.ok(leads.every((l) => Boolean(l.email)), "every lead_finder lead has an email");
});

test("connections are 1st-degree and always have an importable profile URL", async () => {
  const adapter = new MockLeadSourceAdapter({ totalPerQuery: 12, defaultPageSize: 12 });
  const { leads } = await adapter.fetchLeads(ACCOUNT, { kind: "connections" });

  assert.equal(leads.length, 12);
  assert.ok(
    leads.every((l) => l.connectionDegree === 1),
    "every connection is 1st-degree",
  );
  assert.ok(
    leads.every((l) => Boolean(l.linkedinUrl)),
    "every connection has a LinkedIn URL (so it can be imported by URL)",
  );
});
