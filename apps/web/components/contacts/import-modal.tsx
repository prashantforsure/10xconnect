"use client";

import { LEAD_FIELD_KEYS, parseCsv, type ColumnTarget } from "@10xconnect/core";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import {
  type CampaignSummary,
  IMPORT_SOURCES,
  type ImportJobView,
  type ImportSourceKind,
  type ListView,
} from "@/lib/contacts/types";

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
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  lists: ListView[];
  campaigns: CampaignSummary[];
  onImported: () => void | Promise<void>;
}) {
  const api = useApi();
  const [source, setSource] = useState<ImportSourceKind>("csv");

  // Common target fields.
  const [listMode, setListMode] = useState<"existing" | "new">(lists.length ? "existing" : "new");
  const [listId, setListId] = useState<string>(lists[0]?.id ?? "");
  const [listName, setListName] = useState("");
  const [campaignId, setCampaignId] = useState<string>("");
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
  const [engagement, setEngagement] = useState<"likers" | "commenters">("likers");
  const [limit, setLimit] = useState(50);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [sourceListId, setSourceListId] = useState<string>(lists[0]?.id ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
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
    setTags("");
    setStatus(null);
    setError(null);
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

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
    if (listMode === "existing") {
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
      ...target,
    };
  };

  const pollJob = async (jobId: string): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
      const job = await api.request<ImportJobView>(`/leads/import-jobs/${jobId}`);
      if (job.status === "completed") {
        setStatus(
          `Imported ${job.createdCount} new lead${job.createdCount === 1 ? "" : "s"}` +
            (job.duplicateCount ? `, ${job.duplicateCount} duplicate${job.duplicateCount === 1 ? "" : "s"} skipped` : "") +
            (job.failedCount ? `, ${job.failedCount} failed` : "") +
            ". Enrichment is running in the background.",
        );
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

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import contacts"
      description="Bring in leads from a CSV or a LinkedIn source. Duplicates are removed automatically."
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Source picker */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {IMPORT_SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              onClick={() => setSource(s.kind)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                source === s.kind
                  ? "border-primary bg-primary/5"
                  : "border-input hover:bg-accent"
              }`}
            >
              <div className="font-medium">{s.label}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {IMPORT_SOURCES.find((s) => s.kind === source)?.hint}
        </p>

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
                <div className="max-h-56 space-y-2 overflow-auto rounded-md border p-3">
                  {headers.map((header) => (
                    <div key={header} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{header}</span>
                      <select
                        value={mapping[header] ?? "ignore"}
                        onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                        className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-xs"
                      >
                        {["ignore", ...LEAD_FIELD_KEYS].map((key) => (
                          <option key={key} value={key}>
                            {FIELD_LABELS[key] ?? key}
                          </option>
                        ))}
                        <option value={`custom:${header}`}>Custom column "{header}"</option>
                      </select>
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
                <select
                  id="src-eng"
                  value={engagement}
                  onChange={(e) => setEngagement(e.target.value as "likers" | "commenters")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="likers">People who liked the post</option>
                  <option value="commenters">People who commented</option>
                </select>
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
            <select
              id="src-list"
              value={sourceListId}
              onChange={(e) => setSourceListId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Select a list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.leadCount})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Target list + campaign + tags */}
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="space-y-1.5">
            <Label>Import into</Label>
            <div className="flex gap-2">
              <select
                value={listMode === "existing" ? listId : "__new__"}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setListMode("new");
                  } else {
                    setListMode("existing");
                    setListId(e.target.value);
                  }
                }}
                className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="__new__">+ New list…</option>
              </select>
            </div>
            {listMode === "new" ? (
              <Input
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="New list name (optional — auto-named if blank)"
              />
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="enroll">Enroll in campaign (optional)</Label>
              <select
                id="enroll"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="def-tags">Tags (optional)</Label>
              <Input id="def-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, q3-outbound" />
            </div>
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            {done ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Importing…" : "Run import"}
          </Button>
        </div>
      </form>
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
