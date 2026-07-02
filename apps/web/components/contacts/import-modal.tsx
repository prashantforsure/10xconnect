"use client";

import { LEAD_FIELD_KEYS, parseCsv, type ColumnTarget } from "@10xconnect/core";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronRight,
  Compass,
  FileSpreadsheet,
  FolderInput,
  Image as ImageIcon,
  Link2,
  Search,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  type CampaignSummary,
  IMPORT_SOURCES,
  type ImportJobView,
  type ImportSourceKind,
  type ListView,
} from "@/lib/contacts/types";

/** Icon + one-line description per import source, for the card picker (step 1). */
const SOURCE_META: Record<ImportSourceKind, { icon: LucideIcon; description: string }> = {
  linkedin_search: {
    icon: Search,
    description: "Find targets by doing an integrated LinkedIn people search",
  },
  post: {
    icon: ImageIcon,
    description: "Target users who liked or commented on a LinkedIn post",
  },
  event: {
    icon: Calendar,
    description: "Target attendees of a LinkedIn event",
  },
  group: {
    icon: Users,
    description: "Target members of a LinkedIn group",
  },
  csv: {
    icon: FileSpreadsheet,
    description: "Upload a CSV of profiles or emails and map the columns",
  },
  profile_urls: {
    icon: Link2,
    description: "Paste LinkedIn profile URLs — one by one or in bulk",
  },
  sales_navigator: {
    icon: Compass,
    description: "Import people from a Sales Navigator search URL",
  },
  lead_finder: {
    icon: SlidersHorizontal,
    description: "Search by filters + keywords across LinkedIn data",
  },
  list: {
    icon: FolderInput,
    description: "Copy leads from another contact list",
  },
};

const FIELD_LABELS: Record<string, string> = {
  ignore: "— Ignore —",
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  linkedin_url: "LinkedIn URL",
  email: "Email",
  company: "Company",
  role: "Role / title",
  headline: "Headline",
  location: "Location",
  tags: "Tags",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

interface LiveImport {
  id: string;
  source: string;
  status: string;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt: string | null;
}

const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "every 15 min" },
  { value: 30, label: "every 30 min" },
  { value: 60, label: "every hour" },
  { value: 240, label: "every 4 hours" },
  { value: 1440, label: "once a day" },
];

/**
 * Normalize a pasted LinkedIn profile reference to a full URL, or null if it
 * isn't a LinkedIn URL. Accepts a bare "linkedin.com/in/.." (scheme prepended).
 */
function normalizeProfileUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Guess a sensible mapping target for a CSV header. */
function guessTarget(header: string): string {
  const h = header.trim().toLowerCase();
  if (/(linkedin|profile).*url|^linkedin$|profile/.test(h)) return "linkedin_url";
  if (/e-?mail/.test(h)) return "email";
  if (/first.*name|given/.test(h)) return "first_name";
  if (/last.*name|surname|family/.test(h)) return "last_name";
  if (/full.*name|^name$/.test(h)) return "full_name";
  if (/company|organization|org\b/.test(h)) return "company";
  if (/title|role|position/.test(h)) return "role";
  if (/headline/.test(h)) return "headline";
  if (/location|city|country/.test(h)) return "location";
  if (/tag/.test(h)) return "tags";
  return "ignore";
}

export function ImportModal({
  open,
  onClose,
  lists,
  campaigns,
  lockedCampaign,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  lists: ListView[];
  campaigns: CampaignSummary[];
  /** When set, the import is pinned to this campaign and defaults to creating no list. */
  lockedCampaign?: { id: string; name: string };
  onImported: () => void | Promise<void>;
}) {
  const api = useApi();
  // Two-step wizard: pick a source (cards) → fill in its config.
  const [step, setStep] = useState<"source" | "config">("source");
  const [source, setSource] = useState<ImportSourceKind>("csv");

  // Lists shown in the "Existing list" source + "Import into" target. We re-fetch
  // them ourselves on open (authoritative) so the dropdowns are always populated
  // even if the parent hasn't loaded its `lists` prop yet.
  const [fetchedLists, setFetchedLists] = useState<ListView[]>([]);
  const listOptions = fetchedLists.length > 0 ? fetchedLists : lists;

  // Common target fields. "none" = import without creating/linking a contact list.
  const [listMode, setListMode] = useState<"existing" | "new" | "none">(
    lockedCampaign ? "none" : lists.length ? "existing" : "new",
  );
  const [listId, setListId] = useState<string>(lists[0]?.id ?? "");
  const [listName, setListName] = useState("");
  const [campaignId, setCampaignId] = useState<string>(lockedCampaign?.id ?? "");
  const [tags, setTags] = useState("");

  // CSV state.
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // LinkedIn / lead-finder state.
  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [engagement, setEngagement] = useState<"likers" | "commenters" | "both">("likers");
  const [limit, setLimit] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [liveSources, setLiveSources] = useState<LiveImport[]>([]);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [sourceListId, setSourceListId] = useState<string>(lists[0]?.id ?? "");

  // Profile URLs (manual add — one by one or bulk paste).
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("source");
    setSource("csv");
    setCsvText("");
    setCsvName("");
    setHeaders([]);
    setRowCount(0);
    setMapping({});
    setUrl("");
    setKeywords("");
    setTitle("");
    setCompany("");
    setLocation("");
    setLimit(50);
    setAutoRefresh(false);
    setIntervalMinutes(60);
    setTags("");
    setUrls([]);
    setUrlInput("");
    setStatus(null);
    setError(null);
    setSubmitting(false);
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      setLiveSources(await api.request<LiveImport[]>("/leads/import-sources"));
    } catch {
      setLiveSources([]);
    }
  }, [api]);

  const sourceAction = async (id: string, action: "pause" | "resume" | "delete"): Promise<void> => {
    try {
      if (action === "delete") {
        await api.request(`/leads/import-sources/${id}`, { method: "DELETE" });
      } else {
        await api.request(`/leads/import-sources/${id}/${action}`, { method: "POST" });
      }
      await fetchSources();
    } catch (err) {
      setError(errorMessage(err, "Could not update live import"));
    }
  };

  // Parse free text (single URL, comma- or newline-separated list) into
  // normalized LinkedIn profile URLs, appended without duplicates.
  const addUrlsFromText = useCallback((text: string) => {
    const parts = text.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setUrls((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      let added = 0;
      for (const part of parts) {
        const url = normalizeProfileUrl(part);
        if (url && !seen.has(url)) {
          seen.add(url);
          next.push(url);
          added += 1;
        }
      }
      if (added === 0) {
        setError("Enter a valid LinkedIn profile URL (e.g. linkedin.com/in/jane-doe).");
      } else {
        setError(null);
      }
      return next;
    });
    setUrlInput("");
  }, []);

  const close = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  // Lists load asynchronously, so the mount-time state initializers can run
  // before any list exists. Re-derive sensible list defaults whenever the modal
  // opens (or the lists arrive) so "Import into" lands on a real list instead of
  // being stuck on "+ New list…".
  useEffect(() => {
    if (!open) return;
    setStep("source");
    setStatus(null);
    setError(null);
    setListMode(lockedCampaign ? "none" : lists.length ? "existing" : "new");
    setListId(lists[0]?.id ?? "");
    setSourceListId(lists[0]?.id ?? "");
    if (lockedCampaign) setCampaignId(lockedCampaign.id);
    void fetchSources();
    // Authoritative lists load (independent of the parent's timing).
    api
      .request<ListView[]>("/lists")
      .then(setFetchedLists)
      .catch(() => undefined);
  }, [open, lists, lockedCampaign, fetchSources, api]);

  // Once our own lists arrive, backfill the list pickers if they were empty
  // (the parent may have opened us before it loaded any lists).
  useEffect(() => {
    if (fetchedLists.length === 0) return;
    setSourceListId((cur) => cur || (fetchedLists[0]?.id ?? ""));
    if (!lockedCampaign) {
      setListId((cur) => cur || (fetchedLists[0]?.id ?? ""));
      setListMode((cur) => (cur === "new" ? "existing" : cur));
    }
  }, [fetchedLists, lockedCampaign]);

  const onFile = async (file: File): Promise<void> => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setCsvText(text);
    setCsvName(file.name);
    setHeaders(parsed.headers);
    setRowCount(parsed.rows.length);
    const initial: Record<string, string> = {};
    for (const header of parsed.headers) {
      initial[header] = guessTarget(header);
    }
    setMapping(initial);
    setError(null);
  };

  const buildBody = (): Record<string, unknown> | null => {
    const target: Record<string, unknown> = {};
    if (listMode === "none") {
      target.skipList = true;
    } else if (listMode === "existing") {
      if (!listId) {
        setError("Choose a list to import into.");
        return null;
      }
      target.listId = listId;
    } else if (listName.trim()) {
      target.listName = listName.trim();
    }
    if (campaignId) target.campaignId = campaignId;
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length) target.tags = tagList;
    // Continuous import (LinkedIn sources only — guarded by the toggle's visibility).
    const refreshFields = autoRefresh ? { autoRefresh: true, intervalMinutes } : {};

    if (source === "csv") {
      if (!csvText || headers.length === 0) {
        setError("Upload a CSV file first.");
        return null;
      }
      const map: Record<string, ColumnTarget> = {};
      for (const [header, value] of Object.entries(mapping)) {
        map[header] = value.startsWith("custom:")
          ? { custom: value.slice("custom:".length) }
          : (value as ColumnTarget);
      }
      return { source: "csv", csv: csvText, mapping: map, ...target };
    }
    if (source === "profile_urls") {
      if (urls.length === 0) {
        setError("Add at least one LinkedIn profile URL.");
        return null;
      }
      return { source: "profile_urls", urls, ...target };
    }
    if (source === "list") {
      if (!sourceListId) {
        setError("Choose a source list.");
        return null;
      }
      return { source: "list", sourceListId, ...target };
    }
    if (source === "lead_finder") {
      const filters: Record<string, unknown> = {};
      if (title.trim()) filters.title = title.trim();
      if (company.trim()) filters.company = company.trim();
      if (location.trim()) filters.location = location.trim();
      if (!keywords.trim() && Object.keys(filters).length === 0) {
        setError("Enter keywords or at least one filter.");
        return null;
      }
      return {
        source: "lead_finder",
        keywords: keywords.trim() || undefined,
        filters: Object.keys(filters).length ? filters : undefined,
        limit,
        ...refreshFields,
        ...target,
      };
    }
    // url-based LinkedIn sources
    if (!url.trim()) {
      setError("Enter the source URL.");
      return null;
    }
    return {
      source,
      url: url.trim(),
      ...(source === "post" ? { engagement } : {}),
      limit,
      ...refreshFields,
      ...target,
    };
  };

  const pollJob = async (jobId: string): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
      const job = await api.request<ImportJobView>(`/leads/import-jobs/${jobId}`);
      if (job.status === "completed") {
        // Existing-list source: the leads already exist, so "0 new" is expected —
        // the meaningful count is how many were pulled in (and enrolled, if a
        // campaign is locked). Show that instead of a misleading "0 imported".
        if (source === "list") {
          const n = job.totalCount;
          setStatus(
            `${n} contact${n === 1 ? "" : "s"} from the list ` +
              (lockedCampaign ? "added to this campaign." : "processed.") +
              (n === 0 ? " (That list is empty.)" : ""),
          );
        } else {
          setStatus(
            `Imported ${job.createdCount} new lead${job.createdCount === 1 ? "" : "s"}` +
              (job.duplicateCount ? `, ${job.duplicateCount} duplicate${job.duplicateCount === 1 ? "" : "s"} skipped` : "") +
              (job.failedCount ? `, ${job.failedCount} failed` : "") +
              ". Enrichment is running in the background.",
          );
        }
        return;
      }
      if (job.status === "failed") {
        throw new Error(job.error ?? "Import failed");
      }
      setStatus(job.status === "running" ? "Importing…" : "Queued…");
      await new Promise((r) => setTimeout(r, 500));
    }
    setStatus("Import is taking a while — it will finish in the background.");
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const body = buildBody();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    setStatus("Queued…");
    try {
      const job = await api.request<ImportJobView>("/leads/import", { method: "POST", body });
      await pollJob(job.id);
      await onImported();
      if (autoRefresh) {
        void fetchSources();
      }
    } catch (err) {
      setError(errorMessage(err, "Import failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const isUrlSource = useMemo(
    () => ["linkedin_search", "sales_navigator", "event", "post", "group"].includes(source),
    [source],
  );
  const done = status !== null && !submitting && !error;
  const SourceIcon = SOURCE_META[source].icon;
  const sourceLabel = IMPORT_SOURCES.find((s) => s.kind === source)?.label ?? source;

  return (
    <Modal
      open={open}
      onClose={close}
      title={lockedCampaign ? "Import leads into this campaign" : "Import contacts"}
      description={
        step === "source"
          ? lockedCampaign
            ? "Choose where these leads come from. Duplicates are removed automatically."
            : "Choose a source to bring in leads. Duplicates are removed automatically."
          : SOURCE_META[source].description
      }
      className="max-w-2xl"
    >
      {step === "source" ? (
        <div className="space-y-4">
          {liveSources.length > 0 ? (
            <div className="space-y-2 rounded-xl border bg-secondary/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground">Live imports</p>
              {liveSources.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium capitalize">{s.source.replace(/_/g, " ")}</span>
                    {" · "}
                    {INTERVAL_OPTIONS.find((o) => o.value === s.intervalMinutes)?.label ?? `every ${s.intervalMinutes}m`}
                    {" · "}
                    <span className={s.status === "active" ? "text-success" : "text-muted-foreground"}>{s.status}</span>
                  </span>
                  {s.status === "active" ? (
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => void sourceAction(s.id, "pause")}>
                      Pause
                    </button>
                  ) : (
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => void sourceAction(s.id, "resume")}>
                      Resume
                    </button>
                  )}
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => void sourceAction(s.id, "delete")}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Source cards — pick one, then Next */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {IMPORT_SOURCES.map((s) => {
              const Icon = SOURCE_META[s.kind].icon;
              const active = source === s.kind;
              return (
                <button
                  key={s.kind}
                  type="button"
                  onClick={() => setSource(s.kind)}
                  onDoubleClick={() => setStep("config")}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : "border-border bg-card hover:border-[#38321F] hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {SOURCE_META[s.kind].description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end pt-1">
            <Button type="button" onClick={() => setStep("config")}>
              Next
              <ArrowRight />
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {/* Selected-source header — click to change */}
          <button
            type="button"
            onClick={() => setStep("source")}
            className="flex w-full items-center gap-3 rounded-xl border bg-secondary/40 p-3 text-left transition-colors hover:bg-accent"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <SourceIcon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{sourceLabel}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {SOURCE_META[source].description}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              Change
              <ChevronRight className="size-3.5" />
            </span>
          </button>

          {/* Source-specific fields */}
        {source === "csv" ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              {csvName ? `Selected: ${csvName}` : "Choose CSV file"}
            </Button>
            {headers.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{rowCount} rows · map your columns:</p>
                <div className="max-h-56 space-y-2 overflow-auto rounded-xl border bg-secondary/30 p-3">
                  {headers.map((header) => (
                    <div key={header} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{header}</span>
                      <Select
                        value={mapping[header] ?? "ignore"}
                        onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                        className="h-8 w-44 text-xs"
                      >
                        {["ignore", ...LEAD_FIELD_KEYS].map((key) => (
                          <option key={key} value={key}>
                            {FIELD_LABELS[key] ?? key}
                          </option>
                        ))}
                        <option value={`custom:${header}`}>Custom column &quot;{header}&quot;</option>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {source === "profile_urls" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="purls">LinkedIn profile URLs</Label>
              <div className="flex gap-2">
                <Input
                  id="purls"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addUrlsFromText(urlInput);
                    }
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (/[\s,]/.test(text)) {
                      e.preventDefault();
                      addUrlsFromText(text);
                    }
                  }}
                  placeholder="https://www.linkedin.com/in/jane-doe"
                />
                <Button type="button" variant="outline" onClick={() => addUrlsFromText(urlInput)}>
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Press Enter to add one. Paste several at once (one per line or comma-separated).
              </p>
            </div>
            {urls.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {urls.length} profile{urls.length === 1 ? "" : "s"} to import
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setUrls([])}
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto rounded-xl border bg-secondary/30 p-2">
                  {urls.map((u) => (
                    <div key={u} className="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{u}</span>
                      <button
                        type="button"
                        aria-label="Remove"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setUrls((prev) => prev.filter((x) => x !== u))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isUrlSource ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="src-url">Source URL</Label>
              <Input
                id="src-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/..."
              />
            </div>
            {source === "post" ? (
              <div className="space-y-1.5">
                <Label htmlFor="src-eng">Engagement</Label>
                <Select
                  id="src-eng"
                  value={engagement}
                  onChange={(e) => setEngagement(e.target.value as "likers" | "commenters" | "both")}
                >
                  <option value="likers">People who liked the post</option>
                  <option value="commenters">People who commented</option>
                  <option value="both">Both — likers and commenters</option>
                </Select>
              </div>
            ) : null}
            <LimitField value={limit} onChange={setLimit} />
          </div>
        ) : null}

        {source === "lead_finder" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lf-kw">Keywords</Label>
              <Input id="lf-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="head of growth, fintech" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="lf-title">Title</Label>
                <Input id="lf-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-company">Company</Label>
                <Input id="lf-company" value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-loc">Location</Label>
                <Input id="lf-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
            </div>
            <LimitField value={limit} onChange={setLimit} />
          </div>
        ) : null}

        {source === "list" ? (
          <div className="space-y-1.5">
            <Label htmlFor="src-list">Source list</Label>
            {listOptions.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-secondary/30 px-3 py-2.5 text-xs text-muted-foreground">
                You don&apos;t have any contact lists yet. Create one from the Contacts page (or
                import via another source first).
              </p>
            ) : (
              <Select id="src-list" value={sourceListId} onChange={(e) => setSourceListId(e.target.value)}>
                <option value="">Select a list…</option>
                {listOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.leadCount} {l.leadCount === 1 ? "contact" : "contacts"})
                  </option>
                ))}
              </Select>
            )}
          </div>
        ) : null}

        {/* Continuous import toggle (LinkedIn sources) */}
        {isUrlSource || source === "lead_finder" ? (
          <div className="space-y-2 rounded-xl border bg-secondary/40 p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="size-4 accent-primary"
              />
              Keep importing new leads (live import)
            </label>
            <p className="text-xs text-muted-foreground">
              Re-checks this source on a schedule and auto-imports only NEW likes/comments/results after setup.
            </p>
            {autoRefresh ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Check</span>
                <Select
                  value={String(intervalMinutes)}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="h-8 w-40 text-xs"
                >
                  {INTERVAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Target list + campaign + tags */}
        <div className="space-y-3 rounded-xl border bg-secondary/40 p-4">
          {lockedCampaign ? (
            <div className="space-y-1.5">
              <Label>Enrolling into</Label>
              <div className="flex flex-wrap items-center gap-x-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <span className="font-medium">{lockedCampaign.name}</span>
                <span className="text-muted-foreground">— new leads are added straight to this campaign</span>
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Import into</Label>
            <Select
              value={listMode === "none" ? "__none__" : listMode === "existing" ? listId : "__new__"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none__") {
                  setListMode("none");
                } else if (v === "__new__") {
                  setListMode("new");
                } else {
                  setListMode("existing");
                  setListId(v);
                }
              }}
            >
              <option value="__none__">Don&apos;t add to a list (Contacts only)</option>
              {listOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="__new__">+ New list…</option>
            </Select>
            {listMode === "new" ? (
              <Input
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="New list name (optional — auto-named if blank)"
              />
            ) : null}
            {listMode === "none" ? (
              <p className="text-xs text-muted-foreground">
                Leads are added to your Contacts{lockedCampaign ? " and this campaign" : ""} — no new list is created.
              </p>
            ) : null}
          </div>
          <div className={`grid grid-cols-1 gap-3 ${lockedCampaign ? "" : "sm:grid-cols-2"}`}>
            {lockedCampaign ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="enroll">Enroll in campaign (optional)</Label>
                <Select id="enroll" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">No campaign</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="def-tags">Tags (optional)</Label>
              <Input id="def-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, q3-outbound" />
            </div>
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setStep("source")} disabled={submitting}>
            <ArrowLeft />
            Back
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              {done ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Importing…" : "Run import"}
            </Button>
          </div>
        </div>
      </form>
    )}
    </Modal>
  );
}

function LimitField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="src-limit">Max leads</Label>
      <Input
        id="src-limit"
        type="number"
        min={1}
        max={1000}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
        className="w-32"
      />
    </div>
  );
}
