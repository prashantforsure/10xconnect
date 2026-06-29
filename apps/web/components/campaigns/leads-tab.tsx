"use client";

import { Building2, Linkedin, Mail, MapPin, Trash2, Upload, UserPlus } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [lists, setLists] = useState<ListView[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLeads(await api.request<LeadRow[]>(`/campaigns/${campaignId}/leads`));
    } catch (err) {
      setError(errorMessage(err, "Could not load leads"));
    } finally {
      setLoading(false);
    }
  }, [api, campaignId]);

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
    try {
      await api.request(`/campaigns/${campaignId}/leads/${leadId}`, { method: "DELETE" });
      await loadAndNotify();
    } catch (err) {
      setError(errorMessage(err, "Could not remove lead"));
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading leads…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {leads.length} lead{leads.length === 1 ? "" : "s"} enrolled
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
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
          {leads.map((l) => (
            <div key={l.leadId} className="flex items-start gap-3 px-4 py-3">
              <Avatar name={l.name} size="md" />
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
                  onClick={() => void remove(l.leadId)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <EnrollModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        loadLists={() => api.request<ListOption[]>("/lists")}
        enroll={(listId) =>
          api.request<EnrollResult>(`/campaigns/${campaignId}/leads`, { method: "POST", body: { listId } })
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
    </div>
  );
}

function EnrollModal({
  open,
  onClose,
  loadLists,
  enroll,
  onEnrolled,
}: {
  open: boolean;
  onClose: () => void;
  loadLists: () => Promise<ListOption[]>;
  enroll: (listId: string) => Promise<EnrollResult>;
  onEnrolled: () => Promise<void>;
}) {
  const [lists, setLists] = useState<ListOption[]>([]);
  const [listId, setListId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadLists()
        .then(setLists)
        .catch(() => undefined);
    } else {
      setListId("");
      setResult(null);
      setError(null);
    }
  }, [open, loadLists]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!listId || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await enroll(listId);
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
      description="Add a contact list to this campaign. Suppressed and already-contacted leads are skipped automatically."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Select value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">Select a list…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {typeof l.leadCount === "number" ? ` (${l.leadCount})` : ""}
            </option>
          ))}
        </Select>

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
          <Button type="submit" disabled={!listId || submitting}>
            {submitting ? "Enrolling…" : "Enroll"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
