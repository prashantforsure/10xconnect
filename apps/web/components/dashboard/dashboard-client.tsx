"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  Check,
  CheckCircle2,
  Circle,
  DollarSign,
  Flame,
  Inbox,
  Pencil,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { HeroAreaChart } from "@/components/dashboard/charts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { formatUsd, type UnitEconomics } from "@/lib/campaigns/unit-economics";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

type Range = "7d" | "30d" | "all";

interface AnalyticsDeltas {
  connections: number | null;
  conversations: number | null;
  replies: number | null;
  acceptedInvites: number | null;
}
interface SeriesPoint {
  date: string;
  invites: number;
  messages: number;
  accepted: number;
  replies: number;
}
interface WorkspaceAnalytics {
  connections: number;
  conversations: number;
  engagements: number;
  inmails: number;
  messages: number;
  acceptedInvites: number;
  replies: number;
  acceptanceRate: number;
  replyRate: number;
  deltas: AnalyticsDeltas | null;
  series: SeriesPoint[];
  tags: { tag: string; count: number }[];
}

interface AiSdrStats {
  aiReplies: number;
  conversationsHandled: number;
  hotLeads: number;
  escalations: number;
  pendingDrafts: number;
  estimatedHoursSaved: number;
}

/** Per-sender safety snapshot (GET /analytics/accounts) — name, status, daily usage. */
interface SafetyAccount {
  id: string;
  name: string | null;
  status: "active" | "warming" | "paused" | "restricted" | "disconnected";
  healthScore: number;
  computedHealth: number;
  acceptanceRate: number | null;
  connectionRequestsToday: number;
  connectionRequestCap: number;
}

interface CampaignLite {
  id: string;
  name: string;
}

/** One AI suggestion awaiting a human (GET /analytics/review-queue). */
interface ReviewItem {
  draftId: string;
  conversationId: string;
  leadName: string;
  role: string | null;
  company: string | null;
  headline: string | null;
  kind: "draft" | "hot_lead" | "escalation";
  status: "pending" | "escalated";
  reason: string | null;
  body: string | null;
  confidence: number | null;
  summary: string | null;
  nextStep: string | null;
  intentScore: number | null;
  isHot: boolean;
  lastInbound: { body: string | null; at: string } | null;
  createdAt: string;
}
interface ReviewQueue {
  items: ReviewItem[];
  counts: { drafts: number; hot: number };
}

const INDIGO = "#5E6AD2";

const RANGES: { id: Range; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All" },
];
const RANGE_LABEL: Record<Range, string> = {
  "7d": "this week",
  "30d": "this month",
  all: "all time",
};

function timeGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "12 min ago" / "1 h ago" / "3 d ago" — compact relative time. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(diff / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** Trim a string to `max` chars on a word boundary, adding an ellipsis. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s\S*$/, "")}…`;
}

/** Outcome-led greeting subtitle — what the AI actually did. Falls back gracefully. */
function activitySubtitle(aiReplies: number, booked: number): string {
  const parts: string[] = [];
  if (aiReplies > 0) parts.push(`handled ${aiReplies} ${plural(aiReplies, "reply", "replies")}`);
  if (booked > 0) parts.push(`booked ${booked} ${plural(booked, "meeting")}`);
  if (parts.length === 0) {
    return "Here's what your AI SDR is working on across your campaigns.";
  }
  return `While you were away, the AI ${parts.join(" and ")}.`;
}

export function DashboardClient({ greetingName }: { greetingName: string }) {
  const api = useApi();
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();

  const [range, setRange] = useState<Range>("30d");
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => setGreeting(timeGreeting()), []);

  // Base data (range-independent) — connected senders, campaigns, the review queue,
  // the AI-SDR master switch, and whether there's a first conversation (checklist).
  const [safety, setSafety] = useState<SafetyAccount[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [hasConversation, setHasConversation] = useState(false);
  const [loading, setLoading] = useState(true);

  // Range-scoped data.
  const [analytics, setAnalytics] = useState<WorkspaceAnalytics | null>(null);
  const [aiStats, setAiStats] = useState<AiSdrStats | null>(null);
  const [econ, setEcon] = useState<UnitEconomics | null>(null);

  // Interaction state for the review queue.
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [actedIds, setActedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const q = await api.request<ReviewQueue>("/analytics/review-queue?limit=8");
      setQueue(q);
      setActedIds(new Set());
    } catch {
      // keep last-known queue
    }
  }, [api, activeWorkspaceId]);

  const loadBase = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const [accs, camps, convos, sdr, q] = await Promise.all([
        api.request<SafetyAccount[]>("/analytics/accounts"),
        api.request<CampaignLite[]>("/campaigns"),
        api.request<unknown[]>("/conversations").catch(() => []),
        api.request<{ enabled: boolean }>("/ai-sdr/settings").catch(() => null),
        api.request<ReviewQueue>("/analytics/review-queue?limit=8").catch(() => null),
      ]);
      setSafety(accs);
      setCampaigns(camps);
      setHasConversation(convos.length > 0);
      setAiEnabled(sdr?.enabled ?? null);
      setQueue(q);
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);

  const loadAnalytics = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const [a, stats] = await Promise.all([
        api.request<WorkspaceAnalytics>(`/analytics/workspace?range=${range}`),
        api.request<AiSdrStats>(`/analytics/ai-sdr?range=${range}`).catch(() => null),
      ]);
      setAnalytics(a);
      setAiStats(stats);
    } catch {
      // keep last-known analytics
    }
    // Unit economics is non-blocking — the dashboard renders without it.
    api
      .request<UnitEconomics>(`/analytics/unit-economics?range=${range}`)
      .then(setEcon)
      .catch(() => undefined);
  }, [api, activeWorkspaceId, range]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);
  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const approve = useCallback(
    async (item: ReviewItem) => {
      setBusyDraftId(item.draftId);
      setError(null);
      try {
        await api.request(`/conversations/${item.conversationId}/draft/approve`, {
          method: "POST",
          body: {},
        });
        setActedIds((s) => new Set(s).add(item.draftId));
        window.setTimeout(() => {
          void loadQueue();
          void loadAnalytics();
        }, 900);
      } catch (err) {
        setError((err as ApiError)?.message ?? "Could not approve the draft");
      } finally {
        setBusyDraftId(null);
      }
    },
    [api, loadQueue, loadAnalytics],
  );

  const discard = useCallback(
    async (item: ReviewItem) => {
      setBusyDraftId(item.draftId);
      setError(null);
      try {
        await api.request(`/conversations/${item.conversationId}/draft/discard`, {
          method: "POST",
          body: {},
        });
        setActedIds((s) => new Set(s).add(item.draftId));
        window.setTimeout(() => void loadQueue(), 900);
      } catch (err) {
        setError((err as ApiError)?.message ?? "Could not discard the draft");
      } finally {
        setBusyDraftId(null);
      }
    },
    [api, loadQueue],
  );

  const openThread = useCallback(() => router.push("/inbox"), [router]);

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }
  if (loading) {
    return <DashboardSkeleton />;
  }

  const a = analytics;
  const d = a?.deltas ?? null;
  const series = a?.series ?? [];
  const senders = safety.filter((s) => s.status === "active" || s.status === "warming").length;
  const hasAccount = safety.length > 0;
  const hasCampaign = campaigns.length > 0;
  const showChecklist = !hasAccount || !hasCampaign || !hasConversation;

  const items = (queue?.items ?? []).filter((it) => !actedIds.has(it.draftId));
  const draftCount = queue?.counts.drafts ?? 0;
  const hotCount = queue?.counts.hot ?? 0;
  const booked = econ?.bookedMeetings ?? 0;

  return (
    <div className="space-y-5">
      {/* Header — greeting + outcome subtitle, status pill + range toggle */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {greeting}, {greetingName}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {activitySubtitle(aiStats?.aiReplies ?? 0, booked)}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <StatusPill enabled={aiEnabled} senders={senders} />
          <div className="flex overflow-hidden rounded-md border border-border bg-surface">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold transition-colors [transition-duration:140ms]",
                  range === r.id
                    ? "bg-white/[0.08] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* Body — primary column + right rail */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_336px]">
        {/* PRIMARY */}
        <div className="min-w-0 space-y-5">
          {/* Waiting on you — the review-queue hero */}
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[15px] font-semibold text-foreground">Waiting on you</h2>
                {draftCount + hotCount > 0 ? (
                  <span className="rounded-[5px] bg-primary/[0.14] px-2 py-0.5 text-[11px] font-semibold text-indigo-text">
                    {draftCount} {plural(draftCount, "draft")}
                    {hotCount > 0 ? ` · ${hotCount} hot` : ""}
                  </span>
                ) : null}
              </div>
              <Link
                href="/inbox"
                className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Open review queue <ArrowRight className="size-3.5" />
              </Link>
            </div>

            {items.length === 0 ? (
              <AllCaughtUp />
            ) : (
              <div>
                {items.map((it) => (
                  <ReviewRow
                    key={it.draftId}
                    item={it}
                    busy={busyDraftId === it.draftId}
                    expanded={expandedIds.has(it.draftId)}
                    onApprove={() => void approve(it)}
                    onDiscard={() => void discard(it)}
                    onEdit={openThread}
                    onTakeOver={openThread}
                    onToggleSummary={() =>
                      setExpandedIds((s) => {
                        const next = new Set(s);
                        if (next.has(it.draftId)) next.delete(it.draftId);
                        else next.add(it.draftId);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* Recent activity — what ran over the selected window */}
          <ActivityCard a={a} d={d} aiStats={aiStats} booked={booked} campaigns={campaigns.length} range={range} />
        </div>

        {/* RIGHT RAIL */}
        <aside className="space-y-5">
          {showChecklist ? (
            <GetStartedCard hasAccount={hasAccount} hasCampaign={hasCampaign} hasConversation={hasConversation} />
          ) : null}

          <ThisMonthCard a={a} d={d} booked={booked} series={series} range={range} />

          <AccountSafetyCard accounts={safety} />

          <UnitEconomicsCard econ={econ} range={range} />
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- header pill */

function StatusPill({ enabled, senders }: { enabled: boolean | null; senders: number }) {
  if (senders === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        No senders connected
      </span>
    );
  }
  const paused = enabled === false;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        paused ? "bg-warning/[0.14] text-warning" : "bg-primary/[0.14] text-indigo-text",
      )}
    >
      <span className={cn("size-1.5 rounded-full", paused ? "bg-warning" : "bg-primary")} />
      {paused ? "AI SDR paused" : "AI SDR active"} · {senders} {plural(senders, "sender")}
    </span>
  );
}

/* ------------------------------------------------------------- review queue */

function ReviewRow({
  item,
  busy,
  expanded,
  onApprove,
  onDiscard,
  onEdit,
  onTakeOver,
  onToggleSummary,
}: {
  item: ReviewItem;
  busy: boolean;
  expanded: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onEdit: () => void;
  onTakeOver: () => void;
  onToggleSummary: () => void;
}) {
  const subtitle = [item.role, item.company].filter(Boolean).join(", ") || item.headline || null;
  const asked = item.lastInbound?.body?.trim();
  const isDraft = item.kind === "draft";

  return (
    <div className="border-t border-border px-5 py-4 first:border-t-0">
      <div className="flex items-start gap-3">
        <Avatar name={item.leadName} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{item.leadName}</span>
                {subtitle ? (
                  <span className="truncate text-xs text-muted-foreground">· {subtitle}</span>
                ) : null}
                {isDraft && asked ? (
                  <span className="truncate text-xs text-muted-foreground">· {truncate(asked, 40)}</span>
                ) : null}
                {!isDraft ? (
                  <Badge variant={item.isHot ? "warning" : "muted"} className="shrink-0">
                    {item.isHot ? (
                      <>
                        <Flame className="size-3" /> Hot lead
                        {typeof item.intentScore === "number" ? ` · intent ${item.intentScore}` : ""}
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3" /> Escalated
                      </>
                    )}
                  </Badge>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 pt-0.5 text-[11px] text-white/40">{timeAgo(item.createdAt)}</span>
          </div>

          {isDraft ? (
            <>
              {item.body ? (
                <div className="mt-2.5 rounded-lg border border-border bg-inset p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-text">
                    <Sparkles className="size-3" /> AI draft
                    {typeof item.confidence === "number" ? (
                      <span className="font-normal text-muted-foreground">
                        · {Math.round(item.confidence * 100)}% confidence
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{item.body}</p>
                </div>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={onApprove} disabled={busy}>
                  <Check className="size-4" /> Approve &amp; send
                </Button>
                <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
                  <Pencil className="size-4" /> Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
                  <X className="size-4" /> Discard
                </Button>
              </div>
            </>
          ) : (
            <>
              {item.summary ? (
                <p
                  className={cn(
                    "mt-2 text-[13px] leading-relaxed text-muted-foreground",
                    !expanded && "line-clamp-2",
                  )}
                >
                  {item.summary}
                </p>
              ) : (
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  This one needs your attention — the AI paused so you can reply as yourself.
                </p>
              )}
              {expanded && item.nextStep ? (
                <p className="mt-2 text-[12.5px] leading-relaxed text-foreground">
                  <span className="font-medium text-indigo-text">Suggested next step:</span> {item.nextStep}
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={onTakeOver} disabled={busy}>
                  Take over thread
                </Button>
                {item.summary || item.nextStep ? (
                  <Button variant="ghost" size="sm" onClick={onToggleSummary}>
                    {expanded ? "Hide summary" : "View summary"}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AllCaughtUp() {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-success/[0.12] text-success">
        <CheckCircle2 className="size-6" />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">You&apos;re all caught up</p>
      <p className="mt-1 max-w-[22rem] text-[13px] text-muted-foreground">
        No drafts or hot leads waiting. The AI SDR will surface anything that needs you here.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- recent activity */

function ActivityCard({
  a,
  d,
  aiStats,
  booked,
  campaigns,
  range,
}: {
  a: WorkspaceAnalytics | null;
  d: AnalyticsDeltas | null;
  aiStats: AiSdrStats | null;
  booked: number;
  campaigns: number;
  range: Range;
}) {
  const rows: {
    icon: typeof Send;
    tint: string;
    text: ReactNode;
    meta: ReactNode;
  }[] = [
    {
      icon: Send,
      tint: "text-indigo-text",
      text: (
        <>
          Sent <b className="text-foreground">{(a?.connections ?? 0).toLocaleString()}</b>{" "}
          {plural(a?.connections ?? 0, "invite")}
          {campaigns > 0 ? ` across ${campaigns} ${plural(campaigns, "campaign")}` : ""}
        </>
      ),
      meta: <DeltaMeta value={d?.connections ?? null} fallback={RANGE_LABEL[range]} />,
    },
    {
      icon: UserCheck,
      tint: "text-success",
      text: (
        <>
          <b className="text-foreground">{(a?.acceptedInvites ?? 0).toLocaleString()}</b> invites accepted —{" "}
          <span className="text-foreground">{a?.acceptanceRate ?? 0}%</span> acceptance
        </>
      ),
      meta: <DeltaMeta value={d?.acceptedInvites ?? null} suffix="vs prior" fallback="acceptance rate" />,
    },
    {
      icon: Sparkles,
      tint: "text-indigo-text",
      text: (
        <>
          AI answered <b className="text-foreground">{aiStats?.aiReplies ?? 0}</b>{" "}
          {plural(aiStats?.aiReplies ?? 0, "reply", "replies")}
          {aiStats && aiStats.escalations > 0 ? (
            <>
              , escalated <b className="text-foreground">{aiStats.escalations}</b> to you
            </>
          ) : null}
        </>
      ),
      meta:
        aiStats && aiStats.estimatedHoursSaved > 0 ? (
          <span>~{aiStats.estimatedHoursSaved}h saved</span>
        ) : (
          <span>{RANGE_LABEL[range]}</span>
        ),
    },
    {
      icon: CalendarCheck,
      tint: "text-success",
      text: (
        <>
          <b className="text-foreground">{booked.toLocaleString()}</b> {plural(booked, "meeting")} booked
        </>
      ),
      meta: <span>{booked > 0 ? "calendar synced" : RANGE_LABEL[range]}</span>,
    },
  ];

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-[15px] font-semibold text-foreground">Recent activity</h2>
        <span className="text-[11px] text-white/40">{RANGE_LABEL[range]}</span>
      </div>
      <div className="px-2 pb-2">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05]", r.tint)}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{r.text}</span>
              <span className="shrink-0 text-[11.5px] text-white/40">{r.meta}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DeltaMeta({
  value,
  suffix = "vs prior",
  fallback,
}: {
  value: number | null;
  suffix?: string;
  fallback: string;
}) {
  if (typeof value !== "number") {
    return <span>{fallback}</span>;
  }
  const up = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium", up ? "text-success" : "text-destructive")}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(value)}% {suffix}
    </span>
  );
}

/* -------------------------------------------------------------- this month */

function ThisMonthCard({
  a,
  d,
  booked,
  series,
  range,
}: {
  a: WorkspaceAnalytics | null;
  d: AnalyticsDeltas | null;
  booked: number;
  series: SeriesPoint[];
  range: Range;
}) {
  const heading = range === "7d" ? "This week" : range === "30d" ? "This month" : "All time";
  const rangeNote = range === "7d" ? "7 days" : range === "30d" ? "30 days" : "all time";
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">{heading}</h2>
        <span className="text-[11px] text-white/40">{rangeNote}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <StatCell label="Replies" value={(a?.replies ?? 0).toLocaleString()} delta={d?.replies ?? null} />
        <StatCell label="Invites" value={(a?.connections ?? 0).toLocaleString()} delta={d?.connections ?? null} />
        <StatCell label="Acceptance" value={`${a?.acceptanceRate ?? 0}%`} delta={d?.acceptedInvites ?? null} />
        <StatCell label="Meetings booked" value={booked.toLocaleString()} delta={null} />
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <HeroAreaChart values={series.map((p) => p.replies)} color={INDIGO} height={46} />
      </div>
    </section>
  );
}

function StatCell({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-[26px] font-bold leading-none tracking-tight text-foreground">{value}</span>
        {typeof delta === "number" ? <DeltaText value={delta} /> : null}
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DeltaText({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={cn("text-[11px] font-bold", up ? "text-success" : "text-destructive")}>
      {up ? "+" : "−"}
      {Math.abs(value)}%
    </span>
  );
}

/* ----------------------------------------------------------- account safety */

function AccountSafetyCard({ accounts }: { accounts: SafetyAccount[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="size-[15px] text-success" />
          <h2 className="text-[15px] font-semibold text-foreground">Account safety</h2>
        </div>
        <Link
          href="/settings/accounts"
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Manage <ArrowRight className="size-3" />
        </Link>
      </div>
      {accounts.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No accounts connected yet.{" "}
          <Link href="/settings/accounts" className="font-medium text-indigo-text hover:underline">
            Connect one
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-3.5">
          {accounts.map((acc) => (
            <SafetyRow key={acc.id} acc={acc} />
          ))}
        </div>
      )}
    </section>
  );
}

function SafetyRow({ acc }: { acc: SafetyAccount }) {
  const cap = acc.connectionRequestCap || 0;
  const used = acc.connectionRequestsToday || 0;
  const pctUsed = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const restricted = acc.status === "restricted" || acc.status === "disconnected";
  const warming = acc.status === "warming" || acc.status === "paused";
  const dot = restricted ? "bg-destructive" : warming ? "bg-warning" : "bg-success";
  const bar = restricted ? "bg-destructive" : warming || pctUsed >= 90 ? "bg-warning" : "bg-success";

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        <span className="truncate text-[13px] font-medium text-foreground">{acc.name ?? "LinkedIn account"}</span>
        {warming ? <span className="text-[11px] text-warning">· warming</span> : null}
        {restricted ? <span className="text-[11px] text-destructive">· {acc.status}</span> : null}
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {used}/{cap}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pctUsed}%` }} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- unit economics */

function UnitEconomicsCard({ econ, range }: { econ: UnitEconomics | null; range: Range }) {
  const rangeNote = range === "7d" ? "7d" : range === "30d" ? "30d" : "all time";
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Unit economics</h2>
        <DollarSign className="size-4 text-primary" />
      </div>
      {econ && econ.totalSpendUsd > 0 ? (
        <>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="font-display text-[26px] font-bold leading-none tracking-tight text-indigo-text">
                {formatUsd(econ.costPerBookedMeetingUsd)}
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">per booked meeting</div>
            </div>
            <div className="text-right">
              <div className="font-display text-lg font-bold text-foreground">
                {formatUsd(econ.costPerConversationUsd)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">per conversation</div>
            </div>
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-3 text-[11.5px] text-muted-foreground">
            <span>
              {formatUsd(econ.totalSpendUsd)} AI spend · {rangeNote}
            </span>
            <span>{econ.bookedMeetings.toLocaleString()} booked</span>
          </div>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No AI spend {rangeNote === "all time" ? "yet" : `in the last ${rangeNote}`}. Cost per booked meeting appears
          once the AI engages replies and conversations reach the booked stage.
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- checklist */

function GetStartedCard({
  hasAccount,
  hasCampaign,
  hasConversation,
}: {
  hasAccount: boolean;
  hasCampaign: boolean;
  hasConversation: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-[15px] font-semibold text-foreground">Get started</h2>
      <div className="space-y-1.5">
        <ChecklistItem done={hasAccount} label="Connect a LinkedIn account" href="/settings/accounts" />
        <ChecklistItem done={hasCampaign} label="Create a campaign" href="/campaigns" />
        <ChecklistItem done={hasConversation} label="Reply to your first lead" href="/inbox" icon={Inbox} />
      </div>
    </section>
  );
}

function ChecklistItem({
  done,
  label,
  href,
  icon: Icon,
}: {
  done: boolean;
  label: string;
  href: string;
  icon?: typeof Inbox;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.04]",
        done && "opacity-60",
      )}
    >
      {done ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-success text-success-foreground">
          <Check className="size-3" />
        </span>
      ) : Icon ? (
        <Icon className="size-5 text-primary" />
      ) : (
        <Circle className="size-5 text-muted-foreground" />
      )}
      <span className={cn("text-[13px] font-medium text-foreground", done && "line-through")}>{label}</span>
    </Link>
  );
}

/* ---------------------------------------------------------------- skeleton */

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_336px]">
        <div className="space-y-5">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-[190px] rounded-xl" />
          <Skeleton className="h-[170px] rounded-xl" />
          <Skeleton className="h-[150px] rounded-xl" />
        </div>
      </div>
    </div>
  );
}
