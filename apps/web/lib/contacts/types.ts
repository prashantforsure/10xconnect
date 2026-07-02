// Client-side mirrors of the API's contacts views (apps/api leads/lists modules).
// Kept in one place so the contacts page + import modal share them.

export type EnrichStatus = "pending" | "enriching" | "enriched" | "failed";

export interface LeadView {
  id: string;
  linkedinUrl: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  connectionDegree: number | null;
  tags: string[];
  customColumns: Record<string, unknown>;
  enrichStatus: EnrichStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListResult {
  leads: LeadView[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListView {
  id: string;
  name: string;
  color: string | null;
  leadCount: number;
  createdAt: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
}

export interface ImportJobView {
  id: string;
  source: string;
  status: "pending" | "running" | "completed" | "failed";
  listId: string | null;
  campaignId: string | null;
  params: unknown;
  totalCount: number;
  createdCount: number;
  duplicateCount: number;
  failedCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Import sources surfaced in the UI (CLAUDE.md §8). */
export const IMPORT_SOURCES = [
  { kind: "csv", label: "CSV file", hint: "Upload a CSV of profiles or emails and map the columns." },
  { kind: "profile_urls", label: "Profile URLs", hint: "Paste LinkedIn profile URLs — add people one by one or in bulk." },
  { kind: "linkedin_search", label: "LinkedIn search", hint: "People from a LinkedIn search results URL." },
  { kind: "sales_navigator", label: "Sales Navigator", hint: "People from a Sales Navigator search URL." },
  { kind: "event", label: "Event attendees", hint: "Attendees of a LinkedIn event URL." },
  { kind: "post", label: "Post engagement", hint: "People who liked or commented on a post." },
  { kind: "group", label: "Group members", hint: "Members of a LinkedIn group URL." },
  { kind: "lead_finder", label: "Lead finder", hint: "Search by filters + keywords." },
  { kind: "list", label: "Existing list", hint: "Copy leads from another list." },
] as const;

export type ImportSourceKind = (typeof IMPORT_SOURCES)[number]["kind"];

/** A 1st-degree connection in the contacts "Connections" view (GET /leads/connections). */
export interface ConnectionView {
  linkedinUrl: string | null;
  providerId: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  connectionDegree: number | null;
  alreadyContact: boolean;
}

export interface ConnectionsResult {
  connections: ConnectionView[];
  nextCursor: string | null;
  accountConnected: boolean;
}
