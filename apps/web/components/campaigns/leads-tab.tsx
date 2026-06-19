"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { nodeLabel } from "@/lib/campaigns/nodes";

interface LeadRow {
  leadId: string;
  name: string;
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

export function LeadsTab({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (leadId: string): Promise<void> => {
    try {
      await api.request(`/campaigns/${campaignId}/leads/${leadId}`, { method: "DELETE" });
      await load();
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
        <Button onClick={() => setEnrollOpen(true)}>
          <UserPlus />
          Enroll leads
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {leads.length === 0 ? (
        <div className="surface-card border-dashed p-10 text-center text-sm text-muted-foreground">
          No leads yet. Enroll a contact list to start outreach.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
          {leads.map((l) => (
            <div key={l.leadId} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={l.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">
                  {l.currentNodeType ? `At: ${nodeLabel(l.currentNodeType)}` : "—"}
                </div>
              </div>
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
        onEnrolled={load}
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
