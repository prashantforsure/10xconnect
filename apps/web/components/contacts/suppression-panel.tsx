"use client";

import { Ban, ExternalLink, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/loader";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import type { SuppressionEntry, SuppressionListResult } from "@/lib/contacts/types";
import { safeHttpUrl } from "@/lib/utils";

const PAGE_SIZE = 50;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

/**
 * Manage the workspace do-not-contact / suppression list (CLAUDE.md §6/§11). The
 * list is already enforced at enrollment + send by the engine; this surface lets
 * users review, add, and remove suppressed identifiers so nobody is contacted
 * again from ANY campaign. The #1 compliance guardrail + a HeyReach-parity feature.
 */
export function SuppressionPanel() {
  const api = useApi();

  const [result, setResult] = useState<SuppressionListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debounced) params.set("search", debounced);
    try {
      setResult(await api.request<SuppressionListResult>(`/suppression?${params.toString()}`));
    } catch (err) {
      setError(errorMessage(err, "Could not load the do-not-contact list"));
    } finally {
      setLoading(false);
    }
  }, [api, offset, debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = result?.entries ?? [];
  const total = result?.total ?? 0;

  const remove = async (id: string): Promise<void> => {
    await api.request(`/suppression/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            <Ban className="size-5 text-destructive" /> Do not contact
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {total} suppressed · never contacted from any campaign
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="icon" onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Add
          </Button>
        </div>
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <div className="relative w-[230px] max-w-full">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or LinkedIn URL…"
            className="h-9 bg-surface text-[12.5px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <PageLoader />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border bg-card p-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-xl bg-destructive/[0.12] text-destructive">
              <Ban className="size-7" />
            </span>
            <div>
              <p className="font-display text-lg font-semibold text-foreground">
                No one is suppressed
              </p>
              <p className="text-sm text-muted-foreground">
                Add an email or LinkedIn URL, or mark contacts as do-not-contact from the list.
              </p>
            </div>
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> Add entry
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-[10.5px] uppercase tracking-[0.08em] text-white/45">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold">Identifier</th>
                  <th className="px-4 py-3 text-left font-semibold">Reason</th>
                  <th className="px-4 py-3 text-left font-semibold">Added</th>
                  <th className="w-12 px-4 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <SuppressionRow key={e.id} entry={e} onRemove={() => void remove(e.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between px-1 pt-3 text-xs text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                className="bg-surface"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="bg-surface"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <AddSuppressionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={async (body) => {
          await api.request("/suppression", { method: "POST", body });
          await load();
        }}
      />
    </div>
  );
}

function SuppressionRow({ entry, onRemove }: { entry: SuppressionEntry; onRemove: () => void }) {
  const href = safeHttpUrl(entry.linkedinUrl);
  return (
    <tr className="border-b border-white/[0.06] transition-colors last:border-b-0 hover:bg-accent">
      <td className="px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          {entry.email ? <span className="font-medium text-foreground">{entry.email}</span> : null}
          {entry.linkedinUrl ? (
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-chart-2 hover:underline"
              >
                {entry.linkedinUrl} <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">{entry.linkedinUrl}</span>
            )
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Badge variant="secondary">{entry.reason ?? "manual"}</Badge>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {new Date(entry.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove from do-not-contact"
            className="flex size-[26px] items-center justify-center rounded-[7px] bg-secondary text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddSuppressionModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (body: { email?: string; linkedinUrl?: string; reason?: string }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setEmail("");
    setLinkedinUrl("");
    setReason("");
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    if (!email.trim() && !linkedinUrl.trim()) {
      setError("Provide an email or a LinkedIn URL");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(linkedinUrl.trim() ? { linkedinUrl: linkedinUrl.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not add entry"));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add to do-not-contact"
      description="Suppress an email or LinkedIn profile from every campaign."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dnc-email">Email</Label>
          <Input
            id="dnc-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dnc-linkedin">LinkedIn URL</Label>
          <Input
            id="dnc-linkedin"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dnc-reason">Reason (optional)</Label>
          <Input
            id="dnc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="opted out"
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            <X className="size-4" /> Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
