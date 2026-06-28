// Variable injection for message/comment templates: {first_name}, {company}, …
// and {custom.<column>}. Shared default used when no AI resolver is wired (M6
// swaps in the personalization engine). Unknown variables collapse to "".

import type { LeadRow } from "./types";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Build the {variable} → value map for a lead from its enrichment + columns. */
export function leadVariables(lead: LeadRow): Record<string, string> {
  const e = asObject(lead.enrichment);
  const vars: Record<string, string> = {
    first_name: str(e.firstName),
    last_name: str(e.lastName),
    full_name: [str(e.firstName), str(e.lastName)].filter(Boolean).join(" "),
    role: str(e.role),
    seniority: str(e.seniority),
    headline: str(e.headline),
    about: str(e.about),
    location: str(e.location),
    linkedin_url: str(lead.linkedin_url),
    email: str(lead.email),
    connection_degree: lead.connection_degree == null ? "" : str(lead.connection_degree),
    company: str(e.company),
    company_overview: str(e.companyOverview),
    industry: str(e.industry),
    company_website: str(e.companyWebsite),
    company_size: str(e.companySize),
  };
  for (const [k, v] of Object.entries(asObject(lead.custom_columns))) {
    vars[`custom.${k}`] = str(v);
  }
  return vars;
}

/** Replace {var} tokens in a template using a lead's variables. */
export function injectVariables(template: string, lead: LeadRow): string {
  const vars = leadVariables(lead);
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, key: string) => vars[key] ?? "");
}
