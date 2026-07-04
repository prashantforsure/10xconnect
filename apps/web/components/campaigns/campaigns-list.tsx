"use client";

import { GitCompareArrows, LayoutTemplate, Linkedin, Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AbCompareModal } from "@/components/campaigns/ab-compare";
import { type CampaignStatus, CampaignStatusBadge } from "@/components/campaigns/status-badge";
import { TemplatesModal } from "@/components/campaigns/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

interface CampaignMetrics {
  sent: number;
  accepted: number;
  acceptRate: number;
  replyRate: number;
  progress: number;
}

interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  accountId: string | null;
  leadCount: number;
  metrics?: CampaignMetrics;
  createdAt: string;
}

// Order + labels for the status filter chips (only statuses that occur are shown).
const STATUS_ORDER: CampaignStatus[] = ["running", "paused", "draft", "stopped", "completed"];
const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Completed",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function CampaignsList() {
  const api = useApi();
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();

  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [filter, setFilter] = useState<CampaignStatus | "all">("all");

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setCampaigns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setCampaigns(await api.request<CampaignView[]>("/campaigns"));
    } catch (err) {
      setError(errorMessage(err, "Could not load campaigns"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const leadsInFlight = useMemo(() => campaigns.reduce((s, c) => s + c.leadCount, 0), [campaigns]);
  const statusCounts = useMemo(() => {
    const m = new Map<CampaignStatus, number>();
    for (const c of campaigns) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [campaigns]);
  const visible = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace to see its campaigns.</p>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} ·{" "}
            {leadsInFlight.toLocaleString()} lead{leadsInFlight === 1 ? "" : "s"} in flight
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaigns.length >= 2 ? (
            <Button variant="outline" onClick={() => setCompareOpen(true)}>
              <GitCompareArrows />
              Compare
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
            <LayoutTemplate />
            Templates
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New campaign
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <div className="surface-card flex flex-col items-center border-dashed p-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-xl bg-primary/[0.14] text-primary">
            <Megaphone className="size-7" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">No campaigns yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Create your first campaign, add a sequence of steps, enroll leads, and run it.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New campaign
            </Button>
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <LayoutTemplate />
              Start from template
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              All {campaigns.length}
            </FilterChip>
            {STATUS_ORDER.filter((s) => (statusCounts.get(s) ?? 0) > 0).map((s) => (
              <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
                {STATUS_LABEL[s] ?? s} {statusCounts.get(s)}
              </FilterChip>
            ))}
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {visible.map((c) => (
              <CampaignRow key={c.id} campaign={c} />
            ))}
          </div>
        </>
      )}

      <CreateCampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        create={async (name, aiReplyMode) => {
          const c = await api.request<CampaignView>("/campaigns", { method: "POST", body: { name, aiReplyMode } });
          router.push(`/campaigns/${c.id}`);
        }}
      />

      <TemplatesModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />

      <AbCompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status }))}
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
        active ? "bg-foreground text-background" : "border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CampaignRow({ campaign: c }: { campaign: CampaignView }) {
  const m = c.metrics;
  const hasSends = (m?.sent ?? 0) > 0;
  return (
    <Link
      href={`/campaigns/${c.id}`}
      className="surface-card grid grid-cols-1 items-center gap-4 p-5 transition-colors hover:border-primary/40 lg:grid-cols-[1.7fr_repeat(4,1fr)_1.2fr]"
    >
      {/* Name + channel */}
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="truncate font-display text-base font-semibold">{c.name}</span>
          <CampaignStatusBadge status={c.status} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Linkedin className="size-3.5 text-chart-2" />
            LinkedIn
          </span>
          <span>·</span>
          <span>{c.leadCount.toLocaleString()} leads</span>
        </div>
      </div>

      <Metric value={(m?.sent ?? 0).toLocaleString()} label="Sent" />
      <Metric value={(m?.accepted ?? 0).toLocaleString()} label="Accepted" />
      <Metric value={hasSends ? `${m?.acceptRate ?? 0}%` : "—"} label="Accept rate" tone="success" />
      <Metric value={hasSends ? `${m?.replyRate ?? 0}%` : "—"} label="Reply rate" tone="primary" />

      {/* Progress */}
      <div>
        <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${m?.progress ?? 0}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">{m?.progress ?? 0}% complete</div>
      </div>
    </Link>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "success" | "primary";
}) {
  return (
    <div>
      <div
        className={cn(
          "font-display text-base font-bold",
          tone === "success" && "text-success",
          tone === "primary" && "text-primary",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

type AiReplyMode = "approve_all" | "auto_easy_escalate_hard" | "full_auto";

/** Creator-facing AI reply styles (Balanced is the default + recommended). Maps
 * 1:1 to campaigns.autonomy.mode. */
const AI_REPLY_MODES: { value: AiReplyMode; title: string; badge?: string; desc: string }[] = [
  {
    value: "auto_easy_escalate_hard",
    title: "Balanced",
    badge: "Recommended",
    desc: "The AI replies to normal conversation and answers questions it's sure of. Hot leads — pricing, meetings, buying signals — are handed to you.",
  },
  {
    value: "approve_all",
    title: "Manual review",
    desc: "The AI drafts every reply; you approve and send each one. Maximum control.",
  },
  {
    value: "full_auto",
    title: "Autopilot",
    desc: "The AI replies to everything except hot leads. Most hands-off (still never invents facts or auto-handles buyers).",
  },
];

function CreateCampaignModal({
  open,
  onClose,
  create,
}: {
  open: boolean;
  onClose: () => void;
  create: (name: string, aiReplyMode: AiReplyMode) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [aiReplyMode, setAiReplyMode] = useState<AiReplyMode>("auto_easy_escalate_hard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setName("");
    setAiReplyMode("auto_easy_escalate_hard");
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await create(name.trim(), aiReplyMode);
    } catch (err) {
      setError(errorMessage(err, "Could not create campaign"));
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Create campaign" description="Name it and pick how the AI handles replies. You'll build the sequence next.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="campaign-name">Campaign name</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Q3 Founders Outreach"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>AI reply mode</Label>
          <div className="space-y-2">
            {AI_REPLY_MODES.map((m) => {
              const selected = aiReplyMode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setAiReplyMode(m.value)}
                  aria-pressed={selected}
                  className={`flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                    selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-input hover:bg-accent"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {m.title}
                    {m.badge ? (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        {m.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{m.desc}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            You can change this anytime in the campaign&apos;s Context tab. Auto modes need a knowledge base before launch.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
