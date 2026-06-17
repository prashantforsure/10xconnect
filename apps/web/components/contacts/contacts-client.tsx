"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ExternalLink,
  LayoutGrid,
  LayoutList,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ImportModal } from "@/components/contacts/import-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import {
  type CampaignSummary,
  type EnrichStatus,
  type LeadListResult,
  type LeadView,
  type ListView,
} from "@/lib/contacts/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

type ColumnKey = "title" | "company" | "email" | "linkedin" | "tags" | "status";
const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "tags", label: "Tags" },
  { key: "status", label: "Status" },
];
const PAGE_SIZE = 50;
const ENRICH_STATUSES: EnrichStatus[] = ["pending", "enriching", "enriched", "failed"];

type BulkAction = "tag" | "list" | "campaign" | "delete" | null;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

function StatusBadge({ status }: { status: EnrichStatus }) {
  const styles: Record<EnrichStatus, string> = {
    pending: "bg-muted text-muted-foreground",
    enriching: "bg-amber-100 text-amber-800",
    enriched: "bg-emerald-100 text-emerald-800",
    failed: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", styles[status])}>
      {status}
    </span>
  );
}

function degreeLabel(d: number | null): string {
  if (d === 1) return "1st";
  if (d === 2) return "2nd";
  if (d === 3) return "3rd";
  return "";
}

export function ContactsClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [lists, setLists] = useState<ListView[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [result, setResult] = useState<LeadListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters.
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [enrichFilter, setEnrichFilter] = useState<EnrichStatus | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [offset, setOffset] = useState(0);

  // View + columns.
  const [view, setView] = useState<"list" | "board">("list");
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>({
    title: true,
    company: true,
    email: true,
    linkedin: true,
    tags: true,
    status: true,
  });

  // Selection + bulk.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);

  // Modals.
  const [importOpen, setImportOpen] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);

  // Debounce search → reset paging.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadLists = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const [listRes, campaignRes] = await Promise.all([
        api.request<ListView[]>("/lists"),
        api.request<CampaignSummary[]>("/campaigns").catch(() => [] as CampaignSummary[]),
      ]);
      setLists(listRes);
      setCampaigns(campaignRes);
    } catch (err) {
      setError(errorMessage(err, "Could not load lists"));
    }
  }, [api, activeWorkspaceId]);

  const loadLeads = useCallback(async () => {
    if (!activeWorkspaceId) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (activeListId) params.set("listId", activeListId);
    if (enrichFilter) params.set("enrichStatus", enrichFilter);
    if (tagFilter.trim()) params.set("tag", tagFilter.trim());
    try {
      const res = await api.request<LeadListResult>(`/leads?${params.toString()}`);
      setResult(res);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err, "Could not load contacts"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId, offset, debouncedSearch, activeListId, enrichFilter, tagFilter]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const leads = result?.leads ?? [];
  const total = result?.total ?? 0;
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  };
  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([loadLeads(), loadLists()]);
  }, [loadLeads, loadLists]);

  if (!activeWorkspaceId) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        Create or select a workspace to manage contacts.
      </p>
    );
  }

  return (
    <div className="flex h-full">
      {/* Lists sidebar */}
      <aside className="w-56 shrink-0 border-r bg-card/40 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My lists
          </span>
          <button
            type="button"
            onClick={() => setCreateListOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Create list"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <nav className="space-y-0.5">
          <SidebarItem
            active={activeListId === null}
            onClick={() => {
              setActiveListId(null);
              setOffset(0);
            }}
            label="All contacts"
            icon={<Users className="size-4" />}
          />
          {lists.map((l) => (
            <SidebarItem
              key={l.id}
              active={activeListId === l.id}
              onClick={() => {
                setActiveListId(l.id);
                setOffset(0);
              }}
              label={l.name}
              count={l.leadCount}
              color={l.color}
            />
          ))}
          {lists.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No lists yet.</p>
          ) : null}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company…"
              className="pl-8"
            />
          </div>

          <select
            value={enrichFilter}
            onChange={(e) => {
              setEnrichFilter(e.target.value as EnrichStatus | "");
              setOffset(0);
            }}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {ENRICH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <Input
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setOffset(0);
            }}
            placeholder="Filter by tag"
            className="h-9 w-36"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {COLUMNS.map((c) => (
                <DropdownMenuItem
                  key={c.key}
                  onSelect={(e) => {
                    e.preventDefault();
                    setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }));
                  }}
                >
                  <span className="flex w-4 justify-center">
                    {visibleCols[c.key] ? <Check className="size-4" /> : null}
                  </span>
                  {c.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn("px-2.5 py-1.5", view === "list" ? "bg-accent" : "hover:bg-accent/50")}
              aria-label="List view"
            >
              <LayoutList className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("board")}
              className={cn("px-2.5 py-1.5", view === "board" ? "bg-accent" : "hover:bg-accent/50")}
              aria-label="Board view"
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>

          <Button variant="ghost" size="icon" onClick={() => void refreshAll()} aria-label="Refresh">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <Upload /> Import
          </Button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 ? (
          <div className="flex items-center gap-2 border-b bg-accent/40 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setBulkAction("tag")}>
              <Tags /> Tag
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkAction("list")}>
              <Plus /> Add to list
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkAction("campaign")}>
              Enroll
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setBulkAction("delete")}>
              <Trash2 /> Delete
            </Button>
          </div>
        ) : null}

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading contacts…</p>
          ) : leads.length === 0 ? (
            <EmptyState onImport={() => setImportOpen(true)} />
          ) : view === "list" ? (
            <LeadTable
              leads={leads}
              visibleCols={visibleCols}
              selected={selected}
              allSelected={allSelected}
              onToggleAll={toggleAll}
              onToggleOne={toggleOne}
            />
          ) : (
            <LeadBoard leads={leads} selected={selected} onToggleOne={toggleOne} />
          )}
        </div>

        {/* Pagination */}
        {total > 0 ? (
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        lists={lists}
        campaigns={campaigns}
        onImported={refreshAll}
      />
      <CreateListModal
        open={createListOpen}
        onClose={() => setCreateListOpen(false)}
        onCreate={async (name, color) => {
          await api.request("/lists", { method: "POST", body: { name, color } });
          await loadLists();
        }}
      />
      <BulkModal
        action={bulkAction}
        count={selected.size}
        lists={lists}
        campaigns={campaigns}
        onClose={() => setBulkAction(null)}
        onRun={async (body) => {
          await api.request("/leads/bulk", {
            method: "POST",
            body: { ...body, leadIds: [...selected] },
          });
          setBulkAction(null);
          await refreshAll();
        }}
      />
    </div>
  );
}

function SidebarItem({
  active,
  onClick,
  label,
  count,
  color,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  color?: string | null;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        active ? "bg-accent font-medium" : "hover:bg-accent/50",
      )}
    >
      {icon ?? (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color ?? "var(--muted-foreground, #94a3b8)" }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
    </button>
  );
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="size-4 cursor-pointer rounded border-input"
    />
  );
}

function LeadTable({
  leads,
  visibleCols,
  selected,
  allSelected,
  onToggleAll,
  onToggleOne,
}: {
  leads: LeadView[];
  visibleCols: Record<ColumnKey, boolean>;
  selected: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b">
          <th className="w-10 px-3 py-2">
            <Checkbox checked={allSelected} onChange={onToggleAll} />
          </th>
          <th className="px-3 py-2 text-left font-medium">Name</th>
          {visibleCols.title ? <th className="px-3 py-2 text-left font-medium">Title</th> : null}
          {visibleCols.company ? <th className="px-3 py-2 text-left font-medium">Company</th> : null}
          {visibleCols.email ? <th className="px-3 py-2 text-left font-medium">Email</th> : null}
          {visibleCols.linkedin ? <th className="px-3 py-2 text-left font-medium">LinkedIn</th> : null}
          {visibleCols.tags ? <th className="px-3 py-2 text-left font-medium">Tags</th> : null}
          {visibleCols.status ? <th className="px-3 py-2 text-left font-medium">Status</th> : null}
        </tr>
      </thead>
      <tbody>
        {leads.map((lead) => (
          <tr key={lead.id} className={cn("border-b hover:bg-accent/30", selected.has(lead.id) && "bg-accent/30")}>
            <td className="px-3 py-2">
              <Checkbox checked={selected.has(lead.id)} onChange={() => onToggleOne(lead.id)} />
            </td>
            <td className="px-3 py-2">
              <div className="font-medium">{lead.name ?? "—"}</div>
              {lead.location ? <div className="text-xs text-muted-foreground">{lead.location}</div> : null}
            </td>
            {visibleCols.title ? <td className="px-3 py-2 text-muted-foreground">{lead.role ?? lead.headline ?? "—"}</td> : null}
            {visibleCols.company ? <td className="px-3 py-2 text-muted-foreground">{lead.company ?? "—"}</td> : null}
            {visibleCols.email ? <td className="px-3 py-2 text-muted-foreground">{lead.email ?? "—"}</td> : null}
            {visibleCols.linkedin ? (
              <td className="px-3 py-2">
                {lead.linkedinUrl ? (
                  <a
                    href={lead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Profile <ExternalLink className="size-3" />
                    {degreeLabel(lead.connectionDegree) ? (
                      <span className="text-xs text-muted-foreground">({degreeLabel(lead.connectionDegree)})</span>
                    ) : null}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            ) : null}
            {visibleCols.tags ? (
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {lead.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {t}
                    </span>
                  ))}
                </div>
              </td>
            ) : null}
            {visibleCols.status ? (
              <td className="px-3 py-2">
                <StatusBadge status={lead.enrichStatus} />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Kanban grouped by tag (a lead appears under each of its tags; untagged in its own column). */
function LeadBoard({
  leads,
  selected,
  onToggleOne,
}: {
  leads: LeadView[];
  selected: Set<string>;
  onToggleOne: (id: string) => void;
}) {
  const columns = useMemo(() => {
    const byTag = new Map<string, LeadView[]>();
    const untagged: LeadView[] = [];
    for (const lead of leads) {
      if (lead.tags.length === 0) {
        untagged.push(lead);
        continue;
      }
      for (const tag of lead.tags) {
        const arr = byTag.get(tag) ?? [];
        arr.push(lead);
        byTag.set(tag, arr);
      }
    }
    const cols = [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (untagged.length) cols.push(["Untagged", untagged]);
    return cols;
  }, [leads]);

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {columns.map(([tag, items]) => (
        <div key={tag} className="flex w-64 shrink-0 flex-col rounded-lg border bg-card/40">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
            <span className="truncate">{tag}</span>
            <span className="text-xs text-muted-foreground">{items.length}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-auto p-2">
            {items.map((lead) => (
              <div
                key={`${tag}-${lead.id}`}
                className={cn("rounded-md border bg-background p-2 text-sm", selected.has(lead.id) && "ring-1 ring-primary")}
              >
                <div className="flex items-start gap-2">
                  <Checkbox checked={selected.has(lead.id)} onChange={() => onToggleOne(lead.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{lead.name ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {lead.role ?? lead.headline ?? ""} {lead.company ? `· ${lead.company}` : ""}
                    </div>
                    <div className="mt-1">
                      <StatusBadge status={lead.enrichStatus} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Users className="size-10 text-muted-foreground" />
      <div>
        <p className="font-medium">No contacts yet</p>
        <p className="text-sm text-muted-foreground">Import leads from a CSV or a LinkedIn source to get started.</p>
      </div>
      <Button onClick={onImport}>
        <Upload /> Import contacts
      </Button>
    </div>
  );
}

function CreateListModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setName("");
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), color);
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not create list"));
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Create list" description="Group contacts into a named list.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="list-name">Name</Label>
          <Input id="list-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Q3 prospects" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="list-color">Color</Label>
          <input
            id="list-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-16 cursor-pointer rounded-md border border-input bg-transparent"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? "Creating…" : "Create list"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkModal({
  action,
  count,
  lists,
  campaigns,
  onClose,
  onRun,
}: {
  action: BulkAction;
  count: number;
  lists: ListView[];
  campaigns: CampaignSummary[];
  onClose: () => void;
  onRun: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [tags, setTags] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setTags("");
    setError(null);
    setSubmitting(false);
  };
  const close = (): void => {
    reset();
    onClose();
  };

  const run = async (body: Record<string, unknown>): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await onRun(body);
      reset();
    } catch (err) {
      setError(errorMessage(err, "Action failed"));
      setSubmitting(false);
    }
  };

  if (action === null) return null;

  const title =
    action === "tag"
      ? "Add tags"
      : action === "list"
        ? "Add to list"
        : action === "campaign"
          ? "Enroll in campaign"
          : "Delete contacts";

  return (
    <Modal open onClose={close} title={title} description={`${count} contact${count === 1 ? "" : "s"} selected.`}>
      <div className="space-y-4">
        {action === "tag" ? (
          <div className="space-y-2">
            <Label htmlFor="bulk-tags">Tags (comma separated)</Label>
            <Input id="bulk-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, warm" autoFocus />
          </div>
        ) : null}
        {action === "list" ? (
          <div className="space-y-2">
            <Label htmlFor="bulk-list">List</Label>
            <select
              id="bulk-list"
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {action === "campaign" ? (
          <div className="space-y-2">
            <Label htmlFor="bulk-campaign">Campaign</Label>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No campaigns yet — create one first.</p>
            ) : (
              <select
                id="bulk-campaign"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}
        {action === "delete" ? (
          <p className="text-sm text-muted-foreground">
            This permanently deletes the selected contacts and removes them from all lists and campaigns.
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={action === "delete" ? "destructive" : "default"}
            disabled={
              submitting ||
              (action === "tag" && !tags.trim()) ||
              (action === "list" && !listId) ||
              (action === "campaign" && (campaigns.length === 0 || !campaignId))
            }
            onClick={() => {
              if (action === "tag") {
                void run({ action: "add_tags", tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
              } else if (action === "list") {
                void run({ action: "add_to_list", listId });
              } else if (action === "campaign") {
                void run({ action: "enroll_campaign", campaignId });
              } else {
                void run({ action: "delete" });
              }
            }}
          >
            {submitting ? "Working…" : action === "delete" ? "Delete" : "Apply"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
