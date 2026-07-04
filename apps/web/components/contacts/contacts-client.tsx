"use client";

import {
  Activity,
  Ban,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Contact,
  Download,
  ExternalLink,
  LayoutGrid,
  LayoutList,
  Linkedin,
  ListFilter,
  Mail,
  MapPin,
  MessageSquare,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Send,
  Tags,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConnectionsPanel } from "@/components/contacts/connections-panel";
import { ImportModal } from "@/components/contacts/import-modal";
import { SuppressionPanel } from "@/components/contacts/suppression-panel";
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
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import {
  type CampaignSummary,
  type EnrichStatus,
  type LeadActivityItem,
  type LeadDetail,
  type LeadListResult,
  type LeadView,
  type ListView,
} from "@/lib/contacts/types";
import { cn, safeHttpUrl } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

const PAGE_SIZE = 50;
const ENRICH_STATUSES: EnrichStatus[] = ["pending", "enriching", "enriched", "failed"];

type BulkAction = "tag" | "list" | "campaign" | "dnc" | "delete" | null;

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

  // Which main panel is showing: the contacts table, the Connections browser, or
  // the do-not-contact list.
  const [panel, setPanel] = useState<"contacts" | "connections" | "suppression">("contacts");
  const [exporting, setExporting] = useState(false);

  // Filters.
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [enrichFilter, setEnrichFilter] = useState<EnrichStatus | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [offset, setOffset] = useState(0);

  // View.
  const [view, setView] = useState<"list" | "board">("list");

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

  // Export the current filter (or the current selection) to a CSV download.
  const exportCsv = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (debouncedSearch) body.search = debouncedSearch;
      if (activeListId) body.listId = activeListId;
      if (enrichFilter) body.enrichStatus = enrichFilter;
      if (tagFilter.trim()) body.tag = tagFilter.trim();
      if (selected.size > 0) body.selectedIds = [...selected];
      const blob = await api.requestBlob("/leads/export", { method: "POST", body });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "contacts.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, "Could not export contacts"));
    } finally {
      setExporting(false);
    }
  }, [api, debouncedSearch, activeListId, enrichFilter, tagFilter, selected]);

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
      <aside className="flex w-[212px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-3">
        <div className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
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
          <SidebarItem
            active={panel === "suppression"}
            onClick={() => setPanel("suppression")}
            label="Do not contact"
            icon={<Ban className="size-3.5" />}
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
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
            New list
          </button>
        </nav>
      </aside>

      {/* Main */}
      {panel === "connections" ? (
        <ConnectionsPanel campaigns={campaigns} onChanged={refreshAll} />
      ) : panel === "suppression" ? (
        <SuppressionPanel />
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
              <Button
                variant="secondary"
                disabled={exporting || total === 0}
                onClick={() => void exportCsv()}
                title={selected.size > 0 ? "Export selected" : "Export current filter"}
              >
                <Download /> {exporting ? "Exporting…" : "Export"}
              </Button>
              <Button onClick={() => setImportOpen(true)}>
                <Upload /> Import
              </Button>
            </div>
          </div>

          {/* Quiet toolbar */}
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <div className="relative w-[230px] max-w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts…"
                className="h-9 bg-surface pl-9 text-[12.5px]"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="bg-surface">
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

            <div className="ml-auto flex overflow-hidden rounded-[9px] border border-border bg-surface">
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
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-inset px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-primary text-white">
                  <Check className="size-3" strokeWidth={3.2} />
                </span>
                {selected.size} selected
              </span>
              <span className="h-[18px] w-px bg-white/[0.06]" />
              <Button variant="secondary" size="sm" className="bg-surface" onClick={() => setBulkAction("tag")}>
                <Tags /> Tag
              </Button>
              <Button variant="secondary" size="sm" className="bg-surface" onClick={() => setBulkAction("list")}>
                <Plus /> Add to list
              </Button>
              <Button variant="secondary" size="sm" className="bg-surface" onClick={() => setBulkAction("campaign")}>
                Add to campaign
              </Button>
              <Button variant="secondary" size="sm" className="bg-surface" onClick={() => setBulkAction("dnc")}>
                <Ban /> Do not contact
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setBulkAction("delete")}>
                <Trash2 /> Delete
              </Button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="ml-auto flex size-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                selected={selected}
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
                    className="size-7 bg-surface"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-7 bg-surface"
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
        onChanged={refreshAll}
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
            active ? "text-primary" : "text-muted-foreground",
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

/**
 * Lead list — the SAME card as the campaign Leads tab (LeadListRow) for
 * app-wide consistency: avatar + name + degree pill, title·company / headline,
 * and a subtle meta line (location · LinkedIn · email). The campaign tab's
 * expandable step-history is intentionally omitted (it only makes sense inside a
 * campaign). A hover-reveal checkbox + a ⋮ menu carry the contacts-only actions.
 */
function LeadTable({
  leads,
  selected,
  onToggleOne,
  onOpen,
  onEnroll,
}: {
  leads: LeadView[];
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onOpen: (lead: LeadView) => void;
  onEnroll: (id: string) => void;
}) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border bg-card">
      {leads.map((lead) => {
        const href = safeHttpUrl(lead.linkedinUrl);
        const degree = degreeLabel(lead.connectionDegree);
        return (
          <div
            key={lead.id}
            onClick={() => onOpen(lead)}
            className={cn(
              "group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-accent",
              selected.has(lead.id) && "bg-primary/5",
            )}
          >
            {/* Selection — in the campaign card's chevron slot */}
            <span
              className="mt-1 flex opacity-0 transition-opacity group-hover:opacity-100 has-[:checked]:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox checked={selected.has(lead.id)} onChange={() => onToggleOne(lead.id)} />
            </span>

            <Avatar name={lead.name ?? undefined} src={lead.avatarUrl} size="md" />

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{lead.name ?? "—"}</span>
                {degree ? (
                  <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {degree}
                  </span>
                ) : null}
              </div>

              {lead.role || lead.company ? (
                <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  {lead.role ? <span className="truncate">{lead.role}</span> : null}
                  {lead.role && lead.company ? (
                    <span className="text-muted-foreground/50">·</span>
                  ) : null}
                  {lead.company ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Building2 className="size-3 shrink-0" />
                      <span className="truncate">{lead.company}</span>
                    </span>
                  ) : null}
                </div>
              ) : lead.headline ? (
                <div className="truncate text-xs text-muted-foreground">{lead.headline}</div>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {lead.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {lead.location}
                  </span>
                ) : null}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-chart-2 hover:underline"
                  >
                    <Linkedin className="size-3" />
                    Profile
                  </a>
                ) : null}
                {lead.email ? (
                  <a
                    href={`mailto:${lead.email}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex max-w-[16rem] items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{lead.email}</span>
                  </a>
                ) : null}
              </div>
            </div>

            {/* Labels + actions */}
            <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {lead.tags.slice(0, 2).map((t) => (
                <Badge key={t} variant="secondary" className="hidden sm:inline-flex">
                  {t}
                </Badge>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Row actions"
                    className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onOpen(lead)}>View details</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onEnroll(lead.id)}>
                    Add to campaign
                  </DropdownMenuItem>
                  {href ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => window.open(href, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink /> Open LinkedIn
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
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
        <div key={tag} className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-surface p-3">
          <div className="mb-3 flex items-center gap-2 text-[11.5px] font-semibold text-muted-foreground">
            <span className="size-2 rounded-full bg-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{tag}</span>
            <span className="text-white/40">{items.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((lead) => (
              <div
                key={`${tag}-${lead.id}`}
                onClick={() => onOpen(lead)}
                className={cn(
                  "cursor-pointer rounded-[9px] border border-border bg-card p-3 text-sm transition-colors hover:border-white/20",
                  selected.has(lead.id) && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-start gap-2">
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(lead.id)} onChange={() => onToggleOne(lead.id)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{lead.name ?? "—"}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
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

const CAMPAIGN_STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  running: "success",
  active: "success",
  replied: "info",
  completed: "muted",
  stopped: "warning",
  paused: "warning",
  failed: "destructive",
  draft: "muted",
  pending: "muted",
};

function LeadDetailDrawer({
  lead,
  onClose,
  onEnroll,
  onReEnrich,
  onChanged,
}: {
  lead: LeadView | null;
  onClose: () => void;
  onEnroll: (id: string) => void;
  onReEnrich: (id: string) => Promise<void>;
  onChanged: () => void | Promise<void>;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [dncBusy, setDncBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [activity, setActivity] = useState<LeadActivityItem[] | null>(null);
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);

  const leadId = lead?.id ?? null;

  // Load full detail + activity whenever a different lead opens.
  useEffect(() => {
    setBusy(false);
    setDncBusy(false);
    setError(null);
    setDetail(null);
    setActivity(null);
    setNoteDirty(false);
    if (!leadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [d, a] = await Promise.all([
          api.request<LeadDetail>(`/leads/${leadId}`),
          api
            .request<LeadActivityItem[]>(`/leads/${leadId}/activity`)
            .catch(() => [] as LeadActivityItem[]),
        ]);
        if (cancelled) return;
        setDetail(d);
        setNote(d.note ?? "");
        setActivity(a);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Could not load contact"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, leadId]);

  const saveNote = async (): Promise<void> => {
    if (!leadId) return;
    setNoteSaving(true);
    setError(null);
    try {
      await api.request(`/leads/${leadId}`, {
        method: "PATCH",
        body: { note: note.trim() ? note.trim() : null },
      });
      setNoteDirty(false);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err, "Could not save note"));
    } finally {
      setNoteSaving(false);
    }
  };

  const markDnc = async (): Promise<void> => {
    if (!leadId) return;
    setDncBusy(true);
    setError(null);
    try {
      await api.request("/leads/bulk", {
        method: "POST",
        body: { action: "mark_do_not_contact", leadIds: [leadId] },
      });
      await onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Could not mark do-not-contact"));
    } finally {
      setDncBusy(false);
    }
  };

  const open = lead !== null;
  const role = lead?.role ?? lead?.headline ?? null;
  const href = safeHttpUrl(lead?.linkedinUrl);
  const campaigns = detail?.campaigns ?? [];
  const about = detail?.enrichment?.about;
  const recentPosts = detail?.enrichment?.recentPosts ?? [];

  return (
    <SlideOver open={open} onClose={onClose} title={undefined} widthClass="w-[460px] max-w-[94vw]">
      {lead ? (
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border p-[18px]">
            <Avatar name={lead.name ?? undefined} src={lead.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-semibold text-foreground">
                {lead.name ?? "—"}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
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

            {/* Campaign membership — where this lead lives across campaigns. */}
            <Section label="Campaigns">
              {campaigns.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {campaigns.map((c) => (
                    <a
                      key={c.id}
                      href={`/campaigns/${c.id}?tab=leads`}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-white/20"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                        {c.name}
                      </span>
                      <Badge variant={CAMPAIGN_STATUS_VARIANT[c.leadStatus] ?? "muted"}>
                        {c.leadStatus}
                      </Badge>
                      <ExternalLink className="size-3 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Not in any campaign yet.</p>
              )}
            </Section>

            <Section label="Enrichment">
              <div className="overflow-hidden rounded-xl border border-border">
                <DetailRow label="Email" value={lead.email ?? "—"} />
                <DetailRow
                  label="LinkedIn"
                  value={
                    href ? (
                      <a
                        href={href}
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

            {about ? (
              <Section label="About">
                <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-[#D8D0C2]">
                  {about}
                </p>
              </Section>
            ) : null}

            {recentPosts.length > 0 ? (
              <Section label="Recent posts">
                <div className="flex flex-col gap-1.5">
                  {recentPosts.slice(0, 3).map((p, i) => (
                    <div
                      key={p.postId ?? i}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] leading-relaxed text-[#D8D0C2]"
                    >
                      {p.text ?? "—"}
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

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

            {/* Notes — free-text CRM note, saved on demand. */}
            <Section label="Notes">
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteDirty(true);
                }}
                placeholder="Add a private note about this contact…"
                rows={3}
                className="text-[12.5px]"
              />
              {noteDirty ? (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" disabled={noteSaving} onClick={() => void saveNote()}>
                    {noteSaving ? "Saving…" : "Save note"}
                  </Button>
                </div>
              ) : null}
            </Section>

            {/* Activity timeline — cross-campaign actions + messages. */}
            <Section label="Activity">
              {activity === null ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">No activity yet.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activity.slice(0, 30).map((item, i) => (
                    <ActivityRow key={i} item={item} />
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* Footer actions */}
          <div className="border-t border-border p-[18px]">
            {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
            <div className="flex flex-wrap gap-2.5">
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
              <Button variant="ghost" disabled={dncBusy} onClick={() => void markDnc()}>
                <Ban className="size-4" /> {dncBusy ? "Working…" : "Do not contact"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </SlideOver>
  );
}

function ActivityRow({ item }: { item: LeadActivityItem }) {
  const isMessage = item.kind === "message";
  const inbound = item.label === "inbound";
  const Icon = isMessage ? MessageSquare : item.label.includes("email") ? Send : Activity;
  const label = isMessage
    ? inbound
      ? "Reply received"
      : "Message sent"
    : item.label.replace(/_/g, " ");
  return (
    <div className="flex gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          isMessage && inbound ? "bg-chart-2/15 text-chart-2" : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium capitalize text-foreground">{label}</span>
          {item.status ? (
            <span className="text-[10.5px] text-muted-foreground">{item.status}</span>
          ) : null}
        </div>
        {item.body ? (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">{item.body}</p>
        ) : null}
        <span className="text-[10.5px] text-white/40">{new Date(item.at).toLocaleString()}</span>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
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
        !last && "border-b border-white/[0.06]",
      )}
    >
      <span className="w-16 shrink-0 text-[11.5px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border bg-card p-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-xl bg-primary/[0.14] text-primary">
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
  const [color, setColor] = useState("#5E6AD2");
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
          : action === "dnc"
            ? "Mark do-not-contact"
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
        {action === "dnc" ? (
          <p className="text-sm text-muted-foreground">
            Adds the selected contacts to the workspace do-not-contact list. They will never be
            contacted again from any campaign. The contacts themselves stay in your list.
          </p>
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
              } else if (action === "dnc") {
                void run({ action: "mark_do_not_contact" });
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
