import type {
  LeadSourceAccountRef,
  LeadSourceAdapter,
  LeadSourceQuery,
  LeadSourceResult,
  SourcedLead,
} from "@10xconnect/core";

/**
 * Deterministic, in-memory LeadSourceAdapter for local dev + tests (Step 13).
 *
 * The candidate leads a query yields are a pure function of the query, so:
 *  - the same query always returns the same LinkedIn URLs → re-importing a
 *    source dedupes to zero new leads (exercises workspace dedupe), and
 *  - pagination is stable (cursor = numeric offset).
 *
 * Every ~5th lead is email-only (no linkedin_url) so the email dedupe path is
 * exercised too. No real network — this is what Steps 12–15 develop against.
 */
export interface MockLeadSourceConfig {
  /** Total candidate leads a single query resolves to (across pages). Default 24. */
  totalPerQuery?: number;
  /** Default page size when a query omits `limit`. Default 25. */
  defaultPageSize?: number;
  /** Optional artificial latency per page (ms). Default 0. */
  latencyMs?: number;
}

const FIRST_NAMES = [
  "Avery", "Jordan", "Riley", "Casey", "Morgan", "Taylor", "Quinn", "Reese",
  "Hayden", "Rowan", "Skyler", "Emerson", "Finley", "Harper", "Devon", "Sage",
];
const LAST_NAMES = [
  "Bennett", "Carter", "Donovan", "Ellison", "Fletcher", "Grant", "Holloway",
  "Iverson", "Jennings", "Kingsley", "Lambert", "Mercer", "Nolan", "Ortega",
];
const COMPANIES = ["Northwind Labs", "Acme Cloud", "Lumen AI", "Vertex Health", "Orbit Pay"];
const ROLES = ["Head of Growth", "VP Sales", "Founder", "Marketing Lead", "RevOps Manager"];
const LOCATIONS = ["San Francisco, CA", "London, UK", "Berlin, DE", "Austin, TX", "Toronto, CA"];

export class MockLeadSourceAdapter implements LeadSourceAdapter {
  private readonly total: number;
  private readonly defaultPageSize: number;
  private readonly latencyMs: number;

  constructor(config: MockLeadSourceConfig = {}) {
    this.total = config.totalPerQuery ?? 24;
    this.defaultPageSize = config.defaultPageSize ?? 25;
    this.latencyMs = config.latencyMs ?? 0;
  }

  async fetchLeads(
    _account: LeadSourceAccountRef,
    query: LeadSourceQuery,
  ): Promise<LeadSourceResult> {
    await this.delay();

    const seed = hashQuery(query);
    const slugBase = slugify(query.keywords ?? query.url ?? query.kind) || query.kind;

    const offset = parseCursor(query.cursor);
    const pageSize = clampPageSize(query.limit ?? this.defaultPageSize);
    const end = Math.min(offset + pageSize, this.total);

    const leads: SourcedLead[] = [];
    for (let i = offset; i < end; i += 1) {
      leads.push(this.makeLead(query, slugBase, seed, i));
    }

    const result: LeadSourceResult = { leads, total: this.total };
    if (end < this.total) {
      result.nextCursor = String(end);
    }
    return result;
  }

  private makeLead(
    query: LeadSourceQuery,
    slugBase: string,
    seed: number,
    index: number,
  ): SourcedLead {
    const n = index + 1;
    const first = FIRST_NAMES[(seed + index) % FIRST_NAMES.length]!;
    const last = LAST_NAMES[(seed + index * 7) % LAST_NAMES.length]!;
    const company = COMPANIES[(seed + index) % COMPANIES.length]!;
    const role = ROLES[(seed + index * 3) % ROLES.length]!;
    const location = LOCATIONS[(seed + index * 5) % LOCATIONS.length]!;
    // Stable, query-derived slug so the SAME query yields the SAME URLs.
    const slug = `${slugBase}-${first.toLowerCase()}-${last.toLowerCase()}-${n}`;

    const lead: SourcedLead = {
      firstName: first,
      lastName: last,
      headline: `${role} at ${company}`,
      company,
      role,
      location,
      connectionDegree: (index % 2) + 2, // alternate 2nd / 3rd degree
      providerId: `mock-src-${seed}-${n}`,
    };

    // Every 5th candidate is email-only (no LinkedIn URL) to exercise email dedupe.
    if (index % 5 === 4) {
      lead.email = `${first.toLowerCase()}.${last.toLowerCase()}@${slugify(company)}.com`;
    } else {
      lead.linkedinUrl = `https://www.linkedin.com/in/${slug}`;
      if (query.kind === "lead_finder") {
        // lead_finder also resolves a verified email alongside the profile.
        lead.email = `${first.toLowerCase()}.${last.toLowerCase()}@${slugify(company)}.com`;
      }
    }
    return lead;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }
}

function clampPageSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return 25;
  }
  return Math.min(Math.floor(size), 100);
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** FNV-1a — small, deterministic, dependency-free string hash. */
function hashQuery(query: LeadSourceQuery): number {
  const key = [
    query.kind,
    query.url ?? "",
    query.keywords ?? "",
    query.engagement ?? "",
    query.filters ? JSON.stringify(query.filters) : "",
  ].join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash | 0);
}
