// CSV column → lead-field mapping. Used by the import UI (build the mapping) and
// the server (apply it authoritatively). Pure — no provider/SDK or node imports.

/** The standard, first-class lead fields a CSV column can map onto. */
export const LEAD_FIELD_KEYS = [
  "first_name",
  "last_name",
  "full_name",
  "linkedin_url",
  "email",
  "company",
  "role",
  "headline",
  "location",
  "tags",
] as const;

export type LeadFieldKey = (typeof LEAD_FIELD_KEYS)[number];

/**
 * A column's target:
 *  - a LeadFieldKey → maps to that standard field,
 *  - { custom } → stored under leads.custom_columns[name],
 *  - "ignore" → dropped.
 */
export type ColumnTarget = LeadFieldKey | { custom: string } | "ignore";

/** Mapping keyed by CSV header text. Unlisted headers default to "ignore". */
export type ColumnMapping = Record<string, ColumnTarget>;

/** Normalized lead produced from one CSV row by applying a ColumnMapping. */
export interface MappedLeadInput {
  linkedinUrl?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  headline?: string;
  location?: string;
  tags: string[];
  customColumns: Record<string, string>;
}

function isLeadFieldKey(value: unknown): value is LeadFieldKey {
  return typeof value === "string" && (LEAD_FIELD_KEYS as readonly string[]).includes(value);
}

/** Split a delimited tag cell ("a, b; c") into trimmed, de-duped tags. */
export function parseTagCell(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Apply a column mapping to one CSV row (header→value object). full_name is
 * split into first/last only when first_name isn't separately mapped. Blank
 * cells are skipped so they don't overwrite real data with empty strings.
 */
export function applyMapping(
  row: Record<string, string>,
  mapping: ColumnMapping,
): MappedLeadInput {
  const out: MappedLeadInput = { tags: [], customColumns: {} };
  let fullName: string | undefined;

  for (const [header, rawValue] of Object.entries(row)) {
    const target = mapping[header] ?? "ignore";
    if (target === "ignore") {
      continue;
    }
    const value = rawValue.trim();
    if (value === "") {
      continue;
    }

    if (typeof target === "object") {
      out.customColumns[target.custom] = value;
      continue;
    }
    if (!isLeadFieldKey(target)) {
      continue;
    }

    switch (target) {
      case "linkedin_url":
        out.linkedinUrl = value;
        break;
      case "email":
        out.email = value;
        break;
      case "first_name":
        out.firstName = value;
        break;
      case "last_name":
        out.lastName = value;
        break;
      case "full_name":
        fullName = value;
        break;
      case "company":
        out.company = value;
        break;
      case "role":
        out.role = value;
        break;
      case "headline":
        out.headline = value;
        break;
      case "location":
        out.location = value;
        break;
      case "tags":
        out.tags.push(...parseTagCell(value));
        break;
    }
  }

  if (fullName && !out.firstName && !out.lastName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    out.firstName = parts[0];
    if (parts.length > 1) {
      out.lastName = parts.slice(1).join(" ");
    }
  }

  // De-dupe tags accumulated across multiple tag columns.
  out.tags = Array.from(new Set(out.tags));
  return out;
}
