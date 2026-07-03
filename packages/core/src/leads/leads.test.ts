import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeCsvCell, parseCsv, parseCsvToObjects, serializeCsv } from "./csv";
import {
  deriveDedupeKey,
  isLinkedinHttpUrl,
  normalizeEmail,
  normalizeLinkedinUrl,
} from "./dedupe";
import { applyMapping, type ColumnMapping } from "./mapping";

// --- CSV parsing -----------------------------------------------------------

test("parseCsv handles quotes, escaped quotes, embedded commas and CRLF", () => {
  const text = 'name,note\r\n"Doe, Jane","She said ""hi"""\r\nJohn,plain\r\n';
  const { headers, rows } = parseCsv(text);
  assert.deepEqual(headers, ["name", "note"]);
  assert.deepEqual(rows, [
    ["Doe, Jane", 'She said "hi"'],
    ["John", "plain"],
  ]);
});

test("parseCsv pads short rows and ignores a blank trailing line", () => {
  const { rows } = parseCsv("a,b,c\n1,2\n");
  assert.deepEqual(rows, [["1", "2", ""]]);
});

test("parseCsvToObjects keys cells by header", () => {
  const objs = parseCsvToObjects("email,company\njane@acme.com,Acme");
  assert.deepEqual(objs, [{ email: "jane@acme.com", company: "Acme" }]);
});

// --- CSV serialization (export safety) -------------------------------------

test("serializeCsv quotes cells with commas/quotes/newlines and round-trips", () => {
  const csv = serializeCsv(["name", "note"], [["Doe, Jane", 'She said "hi"']]);
  assert.equal(csv, 'name,note\r\n"Doe, Jane","She said ""hi"""\r\n');
});

test("escapeCsvCell neutralizes formula-injection triggers", () => {
  // A leading =, +, -, @ (or tab/CR) is prefixed with ' so a spreadsheet reads it as text.
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeCsvCell("+441234"), "'+441234");
  assert.equal(escapeCsvCell("-5"), "'-5");
  // A plain value is untouched.
  assert.equal(escapeCsvCell("Jane"), "Jane");
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(2), "2");
});

// --- LinkedIn URL safety allowlist -----------------------------------------

test("isLinkedinHttpUrl rejects dangerous schemes + non-linkedin hosts", () => {
  assert.equal(isLinkedinHttpUrl("https://www.linkedin.com/in/jane-doe"), true);
  assert.equal(isLinkedinHttpUrl("http://linkedin.com/in/jane"), true);
  assert.equal(isLinkedinHttpUrl("https://sales.linkedin.com/x"), true);
  // XSS vectors that pass a permissive z.string().url():
  assert.equal(isLinkedinHttpUrl("javascript:alert(1)"), false);
  assert.equal(isLinkedinHttpUrl("data:text/html,<script>1</script>"), false);
  // Wrong host / lookalike:
  assert.equal(isLinkedinHttpUrl("https://evil.com/in/x"), false);
  assert.equal(isLinkedinHttpUrl("https://linkedin.com.evil.com/x"), false);
  assert.equal(isLinkedinHttpUrl(""), false);
  assert.equal(isLinkedinHttpUrl(null), false);
});

// --- normalization + dedupe -------------------------------------------------

test("normalizeLinkedinUrl canonicalizes scheme/case/query/trailing slash", () => {
  const canonical = "linkedin.com/in/jane-doe";
  assert.equal(normalizeLinkedinUrl("https://www.LinkedIn.com/in/Jane-Doe/?utm=x"), canonical);
  assert.equal(normalizeLinkedinUrl("linkedin.com/in/jane-doe"), canonical);
  assert.equal(normalizeLinkedinUrl("http://linkedin.com/in/jane-doe#section"), canonical);
  assert.equal(normalizeLinkedinUrl("https://linkedin.com/company/acme"), undefined);
  assert.equal(normalizeLinkedinUrl(""), undefined);
});

test("normalizeEmail lowercases/trims and rejects junk", () => {
  assert.equal(normalizeEmail("  Jane@Acme.COM "), "jane@acme.com");
  assert.equal(normalizeEmail("not-an-email"), undefined);
});

test("deriveDedupeKey prefers LinkedIn, falls back to email, else undefined", () => {
  assert.equal(
    deriveDedupeKey({ linkedinUrl: "https://www.linkedin.com/in/jane-doe/", email: "j@a.com" }),
    "li:linkedin.com/in/jane-doe",
  );
  assert.equal(deriveDedupeKey({ email: "Jane@Acme.com" }), "email:jane@acme.com");
  assert.equal(deriveDedupeKey({ linkedinUrl: "n/a", email: "" }), undefined);
});

// --- column mapping ---------------------------------------------------------

test("applyMapping maps fields, splits full_name, parses tags, keeps custom cols", () => {
  const mapping: ColumnMapping = {
    Person: "full_name",
    Profile: "linkedin_url",
    Org: "company",
    Labels: "tags",
    Notes: { custom: "notes" },
    Junk: "ignore",
  };
  const result = applyMapping(
    {
      Person: "Jane Doe",
      Profile: "https://linkedin.com/in/jane-doe",
      Org: "Acme",
      Labels: "vip, warm; vip",
      Notes: "met at conf",
      Junk: "drop me",
    },
    mapping,
  );
  assert.equal(result.firstName, "Jane");
  assert.equal(result.lastName, "Doe");
  assert.equal(result.company, "Acme");
  assert.equal(result.linkedinUrl, "https://linkedin.com/in/jane-doe");
  assert.deepEqual(result.tags, ["vip", "warm"]);
  assert.deepEqual(result.customColumns, { notes: "met at conf" });
});

test("applyMapping skips blank cells and prefers explicit first/last over full_name", () => {
  const mapping: ColumnMapping = { F: "first_name", L: "last_name", N: "full_name", E: "email" };
  const result = applyMapping({ F: "Ann", L: "Lee", N: "Should Ignore", E: "  " }, mapping);
  assert.equal(result.firstName, "Ann");
  assert.equal(result.lastName, "Lee");
  assert.equal(result.email, undefined);
});
