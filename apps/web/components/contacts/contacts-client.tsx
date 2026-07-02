"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Contact,
  ExternalLink,
  LayoutGrid,
  LayoutList,
  ListFilter,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConnectionsPanel } from "@/components/contacts/connections-panel";
import { ImportModal } from "@/components/contacts/import-modal";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { SlideOver } from "@/components/ui/slide-over";
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

const STATUS_VARIANT: Record<EnrichStatus, NonNullable<BadgeProps["variant"]>> = {
  pending: "muted",
  enriching: "warning",
  enriched: "success",
  failed: "destructive",
};

function StatusBadge({ status }: { status: EnrichStatus }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "muted"}>{status}</Badge>;
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

  // Which main panel is showing: the contacts table or the Connections browser.
  const [panel, setPanel] = useState<"contacts" | "connections">("contacts");

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
  // Lead enrolled directly from a single-row / drawer action (not the bulk selection).
  const [singleEnroll, setSingleEnroll] = useState<string | null>(null);

  // Lead detail drawer.
  const [detailLead, setDetailLead] = useState<LeadView | null>(null);

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

  // Active list (for the header title) + a friendly subtitle.
  const activeList = activeListId ? lists.find((l) => l.id === activeListId) : null;
  const headerTitle = activeList?.name ?? "All contacts";

  if (!activeWorkspaceId) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        Create or select a workspace to manage contacts.
      </p>
    );
  }

  const filtersActive = Boolean(enrichFilter || tagFilter.trim());

  return (
    <div className="flex h-full bg-background">
      {/* Lists sidebar */}
      <aside className="flex w-[212px] shrink-0 flex-col overflow-y-auto border-r border-border bg-[#1A1811] p-3">
        <div className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#5C564A]">
          My lists
        </div>
        <nav className="flex flex-col gap-0.5">
          <SidebarItem
            active={panel === "contacts" && activeListId === null}
            onClick={() => {
              setPanel("contacts");
              setActiveListId(null);
              setOffset(0);
            }}
            label="All contacts"
            count={total || undefined}
            icon={<Users className="size-3.5" />}
          />
          <SidebarItem
            active={panel === "connections"}
            onClick={() => setPanel("connections")}
            label="Connections"
            icon={<Contact className="size-3.5" />}
          />
          {lists.length > 0 ? <div className="mx-1 my-2 h-px bg-border" /> : null}
          {lists.map((l) => (
            <SidebarItem
              key={l.id}
              active={panel === "contacts" && activeListId === l.id}
              onClick={() => {
                setPanel("contacts");
                setActiveListId(l.id);
                setOffset(0);
              }}
              label={l.name}
              count={l.leadCount}
              color={l.color}
            />
          ))}
          <button
            type="button"
            onClick={() => setCreateListOpen(true)}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#7A7363] transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New list
          </button>
        </nav>
      </aside>

      {/* Main */}
      {panel === "connections" ? (
        <ConnectionsPanel campaigns={campaigns} onChanged={refreshAll} />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
          {/* Title row */}
          <div className="mb-4 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate font-display text-[22px] font-semibold leading-tight tracking-tight text-foreground">
                {headerTitle}
              </h1>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {total} lead{total === 1 ? "" : "s"} · enriched &amp; deduped automatically on import
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => void refreshAll()}
                aria-label="Refresh"
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button onClick={() => setImportOpen(true)}>
                <Upload /> Import
              </Button>
            </div>
          </div>

          {/* Quiet toolbar */}
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <div className="relative w-[230px] max-w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#7A7363]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts…"
                className="h-9 bg-[#1A1811] pl-9 text-[12.5px]"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="bg-[#1A1811]">
                  <ListFilter />
                  Filter
                  {filtersActive ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 p-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
                      Status
                    </Label>
                    <Select
                      id="filter-status"
                      value={enrichFilter}
                      onChange={(e) => {
                        setEnrichFilter(e.target.value as EnrichStatus | "");
                        setOffset(0);
                      }}
                      className="h-9"
                      aria-label="Filter by status"
                    >
                      <option value="">All statuses</option>
                      {ENRICH_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-tag" className="text-xs text-muted-foreground">
                      Tag
                    </Label>
                    <Input
                      id="filter-tag"
                      value={tagFilter}
                      onChange={(e) => {
                        setTagFilter(e.target.value);
                        setOffset(0);
                      }}
                      placeholder="Filter by tag"
                      className="h-9"
                    />
                  </div>
                  {filtersActive ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setEnrichFilter("");
                        setTagFilter("");
                        setOffset(0);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="bg-[#1A1811]">
                  <Columns3 /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
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

            <div className="ml-auto flex overflow-hidden rounded-[9px] border border-border bg-[#1A1811]">
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors",
                  view === "list"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
                aria-label="List view"
              >
                <LayoutList className="size-4" /> List
              </button>
              <button
                type="button"
                onClick={() => setView("board")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors",
                  view === "board"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
                aria-label="Board view"
              >
                <LayoutGrid className="size-4" /> Board
              </button>
            </div>
          </div>

          {/* Bulk action bar — appears only on selection */}
          {selected.size > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[#38321F] bg-[#26221A] px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-primary text-white">
                  <Check className="size-3" strokeWidth={3.2} />
                </span>
                {selected.size} selected
              </span>
              <span className="h-[18px] w-px bg-[#38321F]" />
              <Button variant="secondary" size="sm" className="bg-[#1A1811]" onClick={() => setBulkAction("tag")}>
                <Tags /> Tag
              </Button>
              <Button variant="secondary" size="sm" className="bg-[#1A1811]" onClick={() => setBulkAction("list")}>
                <Plus /> Add to list
              </Button>
              <Button variant="secondary" size="sm" className="bg-[#1A1811]" onClick={() => setBulkAction("campaign")}>
                Add to campaign
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setBulkAction("delete")}>
                <Trash2 /> Delete
              </Button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="ml-auto flex size-7 items-center justify-center rounded-[7px] text-[#7A7363] transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          {/* Content */}
          <div className="min-h-0 flex-1">
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
                onOpen={setDetailLead}
                onEnroll={(id) => setSingleEnroll(id)}
              />
            ) : (
              <LeadBoard leads={leads} selected={selected} onToggleOne={toggleOne} onOpen={setDetailLead} />
            )}

            {/* Pagination */}
            {total > 0 ? (
              <div className="flex items-center justify-between px-1 pt-3 text-xs text-muted-foreground">
                <span>
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-7 bg-[#1A1811]"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-7 bg-[#1A1811]"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Lead detail drawer */}
      <LeadDetailDrawer
        lead={detailLead}
        onClose={() => setDetailLead(null)}
        onEnroll={(id) => {
          setDetailLead(null);
          setSingleEnroll(id);
        }}
        onReEnrich={async (id) => {
          await api.request(`/leads/${id}/enrich`, { method: "POST" });
          await refreshAll();
        }}
      />

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
        action={singleEnroll ? "campaign" : bulkAction}
        count={singleEnroll ? 1 : selected.size}
        lists={lists}
        campaigns={campaigns}
        onClose={() => {
          setBulkAction(null);
          setSingleEnroll(null);
        }}
        onRun={async (body) => {
          const leadIds = singleEnroll ? [singleEnroll] : [...selected];
          await api.request("/leads/bulk", {
            method: "POST",
            body: { ...body, leadIds },
          });
          setBulkAction(null);
          setSingleEnroll(null);
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
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors",
        active
          ? "bg-primary/15 font-semibold text-primary"
          : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon ?? (
        <span
          className="size-[9px] shrink-0 rounded-[3px]"
          style={{ backgroundColor: color ?? "hsl(var(--muted-foreground))" }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span
          className={cn(
            "font-display text-[11px] font-semibold",
            active ? "text-primary" : "text-[#7A7363]",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={cn("size-4 cursor-pointer rounded border-input accent-primary", className)}
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
  onOpen,
  onEnroll,
}: {
  leads: LeadView[];
  visibleCols: Record<ColumnKey, boolean>;
  selected: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  onOpen: (lead: LeadView) => void;
  onEnroll: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-card text-[10.5px] uppercase tracking-[0.08em] text-[#6E675B]">
          <tr className="border-b border-border">
            <th className="w-10 px-4 py-3">
              <span className="flex justify-center">
                <Checkbox checked={allSelected} onChange={onToggleAll} />
              </span>
            </th>
            <th className="px-4 py-3 text-left font-semibold">Lead</th>
            {visibleCols.title ? <th className="px-4 py-3 text-left font-semibold">Title</th> : null}
            {visibleCols.company ? <th className="px-4 py-3 text-left font-semibold">Company</th> : null}
            {visibleCols.email ? <th className="px-4 py-3 text-left font-semibold">Email</th> : null}
            {visibleCols.linkedin ? <th className="px-4 py-3 text-left font-semibold">LinkedIn</th> : null}
            {visibleCols.tags ? <th className="px-4 py-3 text-left font-semibold">Tags</th> : null}
            {visibleCols.status ? <th className="px-4 py-3 text-left font-semibold">Status</th> : null}
            <th className="w-12 px-4 py-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              onClick={() => onOpen(lead)}
              className={cn(
                "crow group cursor-pointer border-b border-[#221F17] transition-colors last:border-b-0 hover:bg-accent",
                selected.has(lead.id) && "bg-primary/5",
              )}
            >
              <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                <span className="flex justify-center">
                  <Checkbox checked={selected.has(lead.id)} onChange={() => onToggleOne(lead.id)} />
                </span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={lead.name ?? undefined} src={lead.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{lead.name ?? "—"}</div>
                    {lead.location ? (
                      <div className="truncate text-xs text-[#7A7363]">{lead.location}</div>
                    ) : null}
                  </div>
                </div>
              </td>
              {visibleCols.title ? (
                <td className="px-4 py-2.5 text-muted-foreground">{lead.role ?? lead.headline ?? "—"}</td>
              ) : null}
              {visibleCols.company ? (
                <td className="px-4 py-2.5 text-[#D8D0C2]">{lead.company ?? "—"}</td>
              ) : null}
              {visibleCols.email ? (
                <td className="px-4 py-2.5 text-[#7A7363]">{lead.email ?? "—"}</td>
              ) : null}
              {visibleCols.linkedin ? (
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {lead.linkedinUrl ? (
                    <a
                      href={lead.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-chart-2 hover:underline"
                    >
                      Profile <ExternalLink className="size-3" />
                      {degreeLabel(lead.connectionDegree) ? (
                        <span className="text-xs text-muted-foreground">
                          ({degreeLabel(lead.connectionDegree)})
                        </span>
                      ) : null}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
              {visibleCols.tags ? (
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {lead.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </td>
              ) : null}
              {visibleCols.status ? (
                <td className="px-4 py-2.5">
                  <StatusBadge status={lead.enrichStatus} />
                </td>
              ) : null}
              <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Row actions"
                        className="flex size-[26px] items-center justify-center rounded-[7px] bg-secondary text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <MoreVertical className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onOpen(lead)}>View details</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onEnroll(lead.id)}>
                        Add to campaign
                      </DropdownMenuItem>
                      {lead.linkedinUrl ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() =>
                              window.open(lead.linkedinUrl!, "_blank", "noopener,noreferrer")
                            }
                          >
                            <ExternalLink /> Open LinkedIn
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Kanban grouped by tag (a lead appears under each of its tags; untagged in its own column). */
function LeadBoard({
  leads,
  selected,
  onToggleOne,
  onOpen,
}: {
  leads: LeadView[];
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onOpen: (lead: LeadView) => void;
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
    <div className="flex gap-3 overflow-x-auto pb-1">
      {columns.map(([tag, items]) => (
        <div key={tag} className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-[#1A1811] p-3">
          <div className="mb-3 flex items-center gap-2 text-[11.5px] font-semibold text-muted-foreground">
            <span className="size-2 rounded-full bg-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{tag}</span>
            <span className="text-[#5C564A]">{items.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((lead) => (
              <div
                key={`${tag}-${lead.id}`}
                onClick={() => onOpen(lead)}
                className={cn(
                  "cursor-pointer rounded-[9px] border border-border bg-card p-3 text-sm transition-colors hover:border-[#38321F]",
                  selected.has(lead.id) && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-start gap-2">
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(lead.id)} onChange={() => onToggleOne(lead.id)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{lead.name ?? "—"}</div>
                    <div className="mt-1 truncate text-xs text-[#7A7363]">
                      {lead.role ?? lead.headline ?? ""} {lead.company ? `· ${lead.company}` : ""}
                    </div>
                    <div className="mt-2">
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

function LeadDetailDrawer({
  lead,
  onClose,
  onEnroll,
  onReEnrich,
}: {
  lead: LeadView | null;
  onClose: () => void;
  onEnroll: (id: string) => void;
  onReEnrich: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever a different lead opens.
  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [lead?.id]);

  const open = lead !== null;
  const role = lead?.role ?? lead?.headline ?? null;

  return (
    <SlideOver open={open} onClose={onClose} title={undefined} widthClass="w-[420px] max-w-[92vw]">
      {lead ? (
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border p-[18px]">
            <Avatar name={lead.name ?? undefined} src={lead.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-semibold text-foreground">
                {lead.name ?? "—"}
              </div>
              <div className="mt-1 truncate text-xs text-[#7A7363]">
                {[role, lead.company].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] border border-input bg-secondary text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-[18px]">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={lead.enrichStatus} />
              {lead.enrichStatus === "enriched" ? (
                <Badge variant="success">
                  <Check className="size-3" strokeWidth={2.4} /> Enriched
                </Badge>
              ) : null}
            </div>

            <Section label="Enrichment">
              <div className="overflow-hidden rounded-xl border border-border">
                <DetailRow label="Email" value={lead.email ?? "—"} />
                <DetailRow
                  label="LinkedIn"
                  value={
                    lead.linkedinUrl ? (
                      <a
                        href={lead.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-chart-2 hover:underline"
                      >
                        View profile <ExternalLink className="size-3" />
                        {degreeLabel(lead.connectionDegree) ? (
                          <span className="text-xs text-muted-foreground">
                            ({degreeLabel(lead.connectionDegree)})
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      "—"
                    )
                  }
                />
                <DetailRow label="Location" value={lead.location ?? "—"} last />
              </div>
            </Section>

            <Section label="Tags">
              {lead.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No tags yet.</p>
              )}
            </Section>
          </div>

          {/* Footer actions */}
          <div className="border-t border-border p-[18px]">
            {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
            <div className="flex gap-2.5">
              <Button className="flex-1" onClick={() => onEnroll(lead.id)}>
                Add to campaign
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onReEnrich(lead.id);
                  } catch (err) {
                    setError(errorMessage(err, "Could not re-enrich"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} />
                {busy ? "Re-enriching…" : "Re-enrich"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </SlideOver>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#7A7363]">
        {label}
      </div>
      {children}
    </div>
  );
}

function DetailRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-3.5 py-2.5",
        !last && "border-b border-[#221F17]",
      )}
    >
      <span className="w-16 shrink-0 text-[11.5px] text-[#7A7363]">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border bg-card p-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <Users className="size-7" />
      </span>
      <div>
        <p className="font-display text-lg font-semibold text-foreground">No contacts yet</p>
        <p className="text-sm text-muted-foreground">
          Import leads from a CSV or a LinkedIn source to get started.
        </p>
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
  const [color, setColor] = useState("#F2683C");
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
            <Select id="bulk-list" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {action === "campaign" ? (
          <div className="space-y-2">
            <Label htmlFor="bulk-campaign">Campaign</Label>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No campaigns yet — create one first.</p>
            ) : (
              <Select
                id="bulk-campaign"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
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
