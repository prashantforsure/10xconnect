"use client";

import { Check, ExternalLink, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import type {
  CampaignSummary,
  ConnectionsResult,
  ConnectionView,
  ImportJobView,
} from "@/lib/contacts/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

function degreeLabel(d: number | null): string {
  if (d === 1) return "1st";
  if (d === 2) return "2nd";
  if (d === 3) return "3rd";
  return "";
}

/**
 * The connected LinkedIn account's 1st-degree connections (CLAUDE.md §8). Live +
 * paged — nothing is stored until the user imports. Selected connections import
 * through the `profile_urls` pipeline; "Enroll in campaign" routes them into a
 * campaign so any messaging stays governed by the rate engine (§2) — there is no
 * direct, un-paced send from this view.
 */
export function ConnectionsPanel({
  campaigns,
  onChanged,
}: {
  campaigns: CampaignSummary[];
  onChanged: () => void | Promise<void>;
}) {
  const api = useApi();

  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [accountConnected, setAccountConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "import" | "enroll">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      const res = await api.request<ConnectionsResult>(`/leads/connections?${params.toString()}`);
      setAccountConnected(res.accountConnected);
      setNextCursor(res.nextCursor);
      setConnections((prev) => (cursor ? [...prev, ...res.connections] : res.connections));
    },
    [api],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setSelected(new Set());
    try {
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not load connections"));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } catch (err) {
      setError(errorMessage(err, "Could not load more"));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = (url: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  // Only connections that have a profile URL and aren't already a contact can be imported.
  const importable = connections.filter((c) => c.linkedinUrl && !c.alreadyContact);
  const allImportableSelected =
    importable.length > 0 && importable.every((c) => selected.has(c.linkedinUrl!));
  const toggleAll = (): void => {
    setSelected(allImportableSelected ? new Set() : new Set(importable.map((c) => c.linkedinUrl!)));
  };

  const pollJob = async (jobId: string): Promise<ImportJobView> => {
    for (let i = 0; i < 40; i += 1) {
      const job = await api.request<ImportJobView>(`/leads/import-jobs/${jobId}`);
      if (job.status === "completed" || job.status === "failed") return job;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Import is taking longer than expected — it will finish in the background.");
  };

  const runImport = async (campaignId?: string): Promise<void> => {
    const urls = [...selected];
    if (urls.length === 0) return;
    setBusy(campaignId ? "enroll" : "import");
    setStatus(null);
    setError(null);
    try {
      const body: Record<string, unknown> = { source: "profile_urls", urls };
      if (campaignId) body.campaignId = campaignId;
      const job = await api.request<ImportJobView>("/leads/import", { method: "POST", body });
      const done = await pollJob(job.id);
      if (done.status === "failed") throw new Error(done.error ?? "Import failed");
      setStatus(
        `Added ${done.createdCount} contact${done.createdCount === 1 ? "" : "s"}` +
          (campaignId ? " and enrolled them in the campaign" : "") +
          (done.duplicateCount ? `, ${done.duplicateCount} already existed` : "") +
          ".",
      );
      setSelected(new Set());
      setEnrollOpen(false);
      await Promise.all([reload(), onChanged()]);
    } catch (err) {
      setError(errorMessage(err, "Import failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
      {/* Header */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 font-display text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            Connections
            {connections.length > 0 ? <Badge variant="muted">{connections.length}</Badge> : null}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Your LinkedIn 1st-degree connections. Select people to add them as contacts or enroll
            them in a campaign.
          </p>
        </div>
        <Button variant="secondary" size="icon" onClick={() => void reload()} aria-label="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* Action bar */}
      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-inset px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
            <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-primary text-white">
              <Check className="size-3" strokeWidth={3.2} />
            </span>
            {selected.size} selected
          </span>
          <span className="h-[18px] w-px bg-white/[0.06]" />
          <Button
            variant="secondary"
            size="sm"
            className="bg-surface"
            disabled={busy !== null}
            onClick={() => void runImport()}
          >
            {busy === "import" ? "Adding…" : "Add to contacts"}
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || campaigns.length === 0}
            onClick={() => setEnrollOpen(true)}
          >
            Enroll in campaign…
          </Button>
        </div>
      ) : null}

      {/* Content */}
      <div className="min-h-0 flex-1">
        {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
        {status ? <p className="pb-3 text-sm text-success">{status}</p> : null}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading connections…</p>
        ) : connections.length === 0 ? (
          <EmptyState accountConnected={accountConnected} />
        ) : (
          <>
            <div className="overflow-hidden rounded-[14px] border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-card text-[10.5px] uppercase tracking-[0.08em] text-white/45">
                  <tr className="border-b border-border">
                    <th className="w-10 px-4 py-3">
                      <span className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={allImportableSelected}
                          onChange={toggleAll}
                          disabled={importable.length === 0}
                          className="size-4 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Title</th>
                    <th className="px-4 py-3 text-left font-semibold">Company</th>
                    <th className="px-4 py-3 text-left font-semibold">LinkedIn</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c, i) => {
                    const url = c.linkedinUrl;
                    const canSelect = Boolean(url) && !c.alreadyContact;
                    const isSelected = url ? selected.has(url) : false;
                    return (
                      <tr
                        key={url ?? c.providerId ?? `${c.name}-${i}`}
                        className={cn(
                          "border-b border-white/[0.06] transition-colors last:border-b-0 hover:bg-accent",
                          isSelected && "bg-primary/5",
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <span className="flex justify-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!canSelect}
                              onChange={() => url && toggle(url)}
                              className="size-4 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.name ?? undefined} src={c.avatarUrl} size="sm" />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{c.name ?? "—"}</div>
                              {c.location ? (
                                <div className="truncate text-xs text-muted-foreground">{c.location}</div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.headline ?? "—"}</td>
                        <td className="px-4 py-2.5 text-[#D8D0C2]">{c.company ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-chart-2 hover:underline"
                            >
                              Profile <ExternalLink className="size-3" />
                              {degreeLabel(c.connectionDegree) ? (
                                <span className="text-xs text-muted-foreground">
                                  ({degreeLabel(c.connectionDegree)})
                                </span>
                              ) : null}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {c.alreadyContact ? (
                            <Badge variant="success">Contact</Badge>
                          ) : (
                            <Badge variant="muted">Not added</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nextCursor ? (
              <div className="flex justify-center pt-3">
                <Button variant="secondary" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Enroll modal */}
      <EnrollModal
        open={enrollOpen}
        count={selected.size}
        campaigns={campaigns}
        busy={busy === "enroll"}
        onClose={() => setEnrollOpen(false)}
        onConfirm={(campaignId) => void runImport(campaignId)}
      />
    </div>
  );
}

function EmptyState({ accountConnected }: { accountConnected: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-xl bg-primary/[0.14] text-primary">
        <Users className="size-7" />
      </span>
      <div>
        <p className="font-display text-lg font-semibold">
          {accountConnected ? "No connections found" : "Connect your LinkedIn account"}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {accountConnected
            ? "We couldn't load any 1st-degree connections for this account yet."
            : "Connect a LinkedIn account in Settings → Accounts to browse and import your connections."}
        </p>
      </div>
    </div>
  );
}

function EnrollModal({
  open,
  count,
  campaigns,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  campaigns: CampaignSummary[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (campaignId: string) => void;
}) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");

  useEffect(() => {
    if (open) setCampaignId(campaigns[0]?.id ?? "");
  }, [open, campaigns]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enroll connections in a campaign"
      description={`${count} connection${count === 1 ? "" : "s"} will be added as contacts and enrolled. Messaging runs through the campaign's governed schedule.`}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="conn-campaign">Campaign</Label>
          <Select id="conn-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !campaignId} onClick={() => onConfirm(campaignId)}>
            {busy ? "Enrolling…" : "Add & enroll"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
