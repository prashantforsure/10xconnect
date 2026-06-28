// Sales Navigator search-URL parsing/validation (Phase 7.3). A Sales Nav search
// link is NOT a profile URL — it's a saved/ad-hoc people search on the Sales
// Navigator surface (linkedin.com/sales/search/people?query=...). We validate the
// URL up front (so a profile/feed URL is rejected before a job is queued) and
// extract the human-readable keyword so the import job + list get a sensible label.
// Pure — no provider/SDK or node imports.

export interface SalesNavSearch {
  /** Canonical search URL (scheme normalized, host lowercased). */
  normalizedUrl: string;
  /** Best-effort keyword text pulled from the query, for labels. */
  keywords?: string;
  /** The Sales Nav surface this search targets. */
  surface: "people" | "company" | "lead";
}

/** True when `url` is a Sales Navigator SEARCH url (people/company/lead search). */
export function isSalesNavigatorSearchUrl(url: string | null | undefined): boolean {
  return parseSalesNavigatorSearchUrl(url) !== null;
}

/**
 * Parse + validate a Sales Navigator search URL. Returns null when the input is
 * not a Sales Nav search (e.g. a /in/ profile url, a regular /search/ url, or
 * junk). Accepts the common surfaces: /sales/search/people, /sales/search/company,
 * and the saved-search form /sales/lists/people/... / /sales/search/lead.
 */
export function parseSalesNavigatorSearchUrl(url: string | null | undefined): SalesNavSearch | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)linkedin\.com$/.test(host)) return null;

  const path = parsed.pathname.toLowerCase();
  // Must be on the Sales Navigator surface.
  if (!path.startsWith("/sales/")) return null;

  let surface: SalesNavSearch["surface"] | null = null;
  if (/\/sales\/search\/people\b/.test(path) || /\/sales\/lists\/people\b/.test(path)) {
    surface = "people";
  } else if (/\/sales\/search\/company\b/.test(path) || /\/sales\/lists\/company\b/.test(path)) {
    surface = "company";
  } else if (/\/sales\/search\/lead\b/.test(path)) {
    surface = "lead";
  }
  if (!surface) return null;

  return {
    normalizedUrl: `${parsed.protocol}//${host}${parsed.pathname}${parsed.search}`,
    keywords: extractKeywords(parsed),
    surface,
  };
}

/**
 * Pull a readable keyword from a Sales Nav query. The modern URL encodes filters
 * in a `query` param like `(keywords:head%20of%20growth,...)`; older/simple forms
 * use `keywords=`. Best-effort — used only for labels, never for matching.
 */
function extractKeywords(parsed: URL): string | undefined {
  const direct = parsed.searchParams.get("keywords");
  if (direct && direct.trim()) return direct.trim();

  const query = parsed.searchParams.get("query");
  if (query) {
    const m = /keywords:([^,)]+)/i.exec(query);
    if (m?.[1]) {
      try {
        return decodeURIComponent(m[1].replace(/%20/g, " ")).trim() || undefined;
      } catch {
        return m[1].trim() || undefined;
      }
    }
  }
  return undefined;
}
