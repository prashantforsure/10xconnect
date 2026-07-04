"use client";

import {
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Linkedin,
  Mail,
  MapPin,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ImportModal } from "@/components/contacts/import-modal";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { nodeLabel } from "@/lib/campaigns/nodes";
import type { ListView } from "@/lib/contacts/types";

interface LeadRow {
  leadId: string;
  name: string;
  avatarUrl: string | null;
  title: string | null;
  company: string | null;
  headline: string | null;
  location: string | null;
  linkedinUrl: string | null;
  email: string | null;
  connectionDegree: string | null;
  status: string;
  currentNodeType: string | null;
  updatedAt: string;
}
interface ListOption {
  id: string;
  name: string;
  leadCount?: number;
}

const PAGE_SIZE = 50;
interface EnrollResult {
  enrolled: number;
  skippedSuppressed: number;
  skippedAlreadyContacted: number;
  skippedDuplicate: number;
}

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  active: "success",
  completed: "secondary",
  replied: "default",
  failed: "destructive",
  stopped: "muted",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function LeadsTab({
  campaignId,
  campaignName,
  onChanged,
}: {
  campaignId: string;
  campaignName: string;
  /** Fired after enroll/import/remove so the parent can refresh launch readiness. */
  onChanged?: () => void;
}) {
  const api = useApi();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [lists, setLists] = useState<ListView[]>([]);
  // Removing a lead deletes their campaign progress — confirm before doing it.
  const [confirmRemove, setConfirmRemove] = useState<LeadRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.request<{ leads: LeadRow[]; total: number }>(
        `/campaigns/${campaignId}/leads?limit=${PAGE_SIZE}&offset=0`,
      );
      setLeads(res.leads);
      setTotal(res.total);
    } catch (err) {
      setError(errorMessage(err, "Could not load leads"));
    } finally {
      setLoading(false);
    }
  }, [api, campaignId]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await api.request<{ leads: LeadRow[]; total: number }>(
        `/campaigns/${campaignId}/leads?limit=${PAGE_SIZE}&offset=${leads.length}`,
      );
      setLeads((prev) => [...prev, ...res.leads]);
      setTotal(res.total);
    } catch (err) {
      setError(errorMessage(err, "Could not load more leads"));
    } finally {
      setLoadingMore(false);
    }
  }, [api, campaignId, leads.length]);

  // Reload our list AND notify the parent (campaign leadCount drives the gate).
  const loadAndNotify = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const openImport = useCallback(async () => {
    setImportOpen(true);
    try {
      setLists(await api.request<ListView[]>("/lists"));
    } catch {
      // Non-fatal — the modal still works with the default "no list" option.
    }
  }, [api]);

  const lockedCampaign = useMemo(
    () => ({ id: campaignId, name: campaignName }),
    [campaignId, campaignName],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (leadId: string): Promise<void> => {
    setRemoving(true);
    try {
      await api.request(`/campaigns/${campaignId}/leads/${leadId}`, { method: "DELETE" });
      await loadAndNotify();
    } catch (err) {
      setError(errorMessage(err, "Could not remove lead"));
    } finally {
      setRemoving(false);
      setConfirmRemove(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading leads…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} lead{total === 1 ? "" : "s"} enrolled
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void openImport()}>
            <Upload />
            Import leads
          </Button>
          <Button onClick={() => setEnrollOpen(true)}>
            <UserPlus />
            Enroll leads
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {leads.length === 0 ? (
        <div className="surface-card border-dashed p-10 text-center text-sm text-muted-foreground">
          No leads yet. Import new leads or enroll a contact list to start outreach.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {leads.map((l) => (
            <LeadListRow key={l.leadId} lead={l} campaignId={campaignId} onRemove={() => setConfirmRemove(l)} />
          ))}
        </div>
      )}

      {leads.length < total ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load more (${total - leads.length} remaining)`}
          </Button>
        </div>
      ) : null}

      <EnrollModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        loadLists={() => api.request<ListOption[]>("/lists")}
        loadContactCount={async () =>
          (await api.request<{ total: number }>("/leads?limit=1")).total
        }
        enroll={(body) =>
          api.request<EnrollResult>(`/campaigns/${campaignId}/leads`, { method: "POST", body })
        }
        onEnrolled={loadAndNotify}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        lists={lists}
        campaigns={[]}
        lockedCampaign={lockedCampaign}
        onImported={loadAndNotify}
      />

      <Modal
        open={confirmRemove !== null}
        onClose={() => (removing ? undefined : setConfirmRemove(null))}
        title={confirmRemove ? `Remove ${confirmRemove.name} from this campaign?` : "Remove lead?"}
        description="Their queued actions are cancelled and their progress in this campaign is deleted. The contact itself stays in your workspace."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmRemove(null)} disabled={removing}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => confirmRemove && void remove(confirmRemove.leadId)}
            disabled={removing}
          >
            {removing ? "Removing…" : "Remove lead"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

interface StageHistoryEntry {
  nodeId?: string;
  type: string;
  at: string;
  outcome?: string;
}
interface StageResponse {
  status: string;
  currentNodeId: string | null;
  currentNodeType: string | null;
  history: StageHistoryEntry[];
}

/** A lead row with an expandable per-lead timeline (served by /leads/:id/stage). */
function LeadListRow({
  lead: l,
  campaignId,
  onRemove,
}: {
  lead: LeadRow;
  campaignId: string;
  onRemove: (leadId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Hide history" : "Show history"}
          aria-expanded={expanded}
          className="mt-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Avatar name={l.name} src={l.avatarUrl} size="md" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{l.name}</span>
            {l.connectionDegree ? (
              <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {l.connectionDegree}
              </span>
            ) : null}
          </div>

          {l.title || l.company ? (
            <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {l.title ? <span className="truncate">{l.title}</span> : null}
              {l.title && l.company ? <span className="text-muted-foreground/50">·</span> : null}
              {l.company ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Building2 className="size-3 shrink-0" />
                  <span className="truncate">{l.company}</span>
                </span>
              ) : null}
            </div>
          ) : l.headline ? (
            <div className="truncate text-xs text-muted-foreground">{l.headline}</div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {l.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {l.location}
              </span>
            ) : null}
            {l.linkedinUrl ? (
              <a
                href={l.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-chart-2 hover:underline"
              >
                <Linkedin className="size-3" />
                Profile
              </a>
            ) : null}
            {l.email ? (
              <a
                href={`mailto:${l.email}`}
                className="inline-flex max-w-[16rem] items-center gap-1 hover:text-foreground hover:underline"
              >
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{l.email}</span>
              </a>
            ) : null}
            <span>{l.currentNodeType ? `At: ${nodeLabel(l.currentNodeType)}` : "Not started"}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={STATUS_VARIANT[l.status] ?? "muted"}>{l.status}</Badge>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => void onRemove(l.leadId)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {expanded ? <LeadTimeline campaignId={campaignId} leadId={l.leadId} /> : null}
    </div>
  );
}

/** Lazily-loaded per-lead progress timeline (step history + current position). */
function LeadTimeline({ campaignId, leadId }: { campaignId: string; leadId: string }) {
  const api = useApi();
  const [stage, setStage] = useState<StageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .request<StageResponse>(`/campaigns/${campaignId}/leads/${leadId}/stage`)
      .then((s) => {
        if (!cancelled) setStage(s);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load history"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, campaignId, leadId]);

  return (
    <div className="border-t bg-secondary/20 py-3 pl-11 pr-4">
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading history…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !stage || stage.history.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {stage?.currentNodeType
            ? `Waiting at: ${nodeLabel(stage.currentNodeType)}. No steps completed yet.`
            : "No steps completed yet."}
        </p>
      ) : (
        <ol className="space-y-2">
          {stage.history.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <Clock className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <span className="font-medium text-foreground">{nodeLabel(h.type)}</span>
                {h.outcome && h.outcome !== "next" ? (
                  <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {h.outcome}
                  </span>
                ) : null}
                <span className="ml-2 text-muted-foreground">
                  {h.at ? new Date(h.at).toLocaleString() : "—"}
                </span>
              </div>
            </li>
          ))}
          {stage.currentNodeType ? (
            <li className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 size-3 shrink-0 rounded-full border border-primary/60" />
              <span className="text-muted-foreground">
                Currently at{" "}
                <span className="font-medium text-foreground">{nodeLabel(stage.currentNodeType)}</span>
              </span>
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

const ALL_CONTACTS = "__all__";

function EnrollModal({
  open,
  onClose,
  loadLists,
  loadContactCount,
  enroll,
  onEnrolled,
}: {
  open: boolean;
  onClose: () => void;
  loadLists: () => Promise<ListOption[]>;
  loadContactCount: () => Promise<number>;
  enroll: (body: { listId?: string; allContacts?: boolean }) => Promise<EnrollResult>;
  onEnrolled: () => Promise<void>;
}) {
  const [lists, setLists] = useState<ListOption[]>([]);
  const [contactCount, setContactCount] = useState<number | null>(null);
  // Default to "All contacts" so newly-imported leads (which often aren't in any
  // list) can be enrolled without first building a list.
  const [choice, setChoice] = useState<string>(ALL_CONTACTS);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChoice(ALL_CONTACTS);
      loadLists()
        .then(setLists)
        .catch(() => undefined);
      loadContactCount()
        .then(setContactCount)
        .catch(() => setContactCount(null));
    } else {
      setResult(null);
      setError(null);
      setContactCount(null);
    }
  }, [open, loadLists, loadContactCount]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!choice || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await enroll(
        choice === ALL_CONTACTS ? { allContacts: true } : { listId: choice },
      );
      setResult(res);
      await onEnrolled();
    } catch (err) {
      setError(errorMessage(err, "Could not enroll leads"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enroll leads"
      description="Add your contacts to this campaign. Suppressed and already-contacted leads are skipped automatically."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Enroll from</label>
          <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value={ALL_CONTACTS}>
              All contacts{contactCount !== null ? ` (${contactCount})` : ""}
            </option>
            {lists.length > 0 ? (
              <optgroup label="Lists">
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {typeof l.leadCount === "number" ? ` (${l.leadCount})` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
          <p className="text-xs text-muted-foreground">
            {choice === ALL_CONTACTS
              ? "Every contact in your workspace will be enrolled."
              : "Only contacts in the selected list will be enrolled."}
          </p>
        </div>

        {result ? (
          <div className="rounded-xl border bg-secondary/50 px-3 py-2 text-sm">
            Enrolled {result.enrolled}. Skipped: {result.skippedAlreadyContacted} already contacted,{" "}
            {result.skippedSuppressed} suppressed, {result.skippedDuplicate} duplicate.
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {result ? "Done" : "Cancel"}
          </Button>
          <Button type="submit" disabled={!choice || submitting}>
            {submitting ? "Enrolling…" : "Enroll"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
