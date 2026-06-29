"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Circle,
  DollarSign,
  Inbox,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  HealthRing,
  HeroAreaChart,
  HorizontalFunnel,
  MixDonut,
  Sparkline,
} from "@/components/dashboard/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_COLORS } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
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

interface AccountLite {
  status: "active" | "warming" | "paused" | "restricted" | "disconnected";
  health_score: number;
}

interface CampaignLite {
  id: string;
  name: string;
  leadCount: number;
  metrics?: { sent: number; acceptRate: number; progress: number };
}

// Command Dark chart palette — fixed brand hexes mirroring the --chart-* tokens
// so sparklines/areas read on the dark surface (coral · blue · green · violet).
const CORAL = "#F2683C";
const BLUE = "#3C8FE2";
const GREEN = "#34D39A";
const VIOLET = "#A878F0";

const RANGES: { id: Range; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All" },
];
const RANGE_LABEL: Record<Range, string> = { "7d": "last 7 days", "30d": "last 30 days", all: "all time" };

function timeGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** Roll the per-account statuses up into one workspace-level safety state. */
function overallHealth(accounts: AccountLite[]): { label: string; tone: "success" | "warning" | "destructive" } {
  if (accounts.some((a) => a.status === "restricted")) {
    return { label: "At risk", tone: "destructive" };
  }
  if (accounts.some((a) => a.status === "warming" || a.status === "paused")) {
    return { label: "Warming up", tone: "warning" };
  }
  return { label: "Healthy", tone: "success" };
}

export function DashboardClient({ greetingName }: { greetingName: string }) {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [hasConversation, setHasConversation] = useState(false);
  const [analytics, setAnalytics] = useState<WorkspaceAnalytics | null>(null);
  const [econ, setEcon] = useState<UnitEconomics | null>(null);
  const [range, setRange] = useState<Range>("30d");
  const [loading, setLoading] = useState(true);
  // Time-of-day greeting is resolved after mount to avoid a server/client clock mismatch.
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => setGreeting(timeGreeting()), []);

  const loadBase = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      const [accs, camps, convos] = await Promise.all([
        api.request<AccountLite[]>("/accounts"),
        api.request<CampaignLite[]>("/campaigns"),
        api.request<unknown[]>("/conversations"),
      ]);
      setAccounts(accs);
      setCampaigns(camps);
      setHasConversation(convos.length > 0);
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);

  const loadAnalytics = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      setAnalytics(await api.request<WorkspaceAnalytics>(`/analytics/workspace?range=${range}`));
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

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }

  const hasAccount = accounts.length > 0;
  const hasCampaign = campaigns.length > 0;
  const allDone = hasAccount && hasCampaign && hasConversation;

  const a = analytics;
  const d = a?.deltas ?? null;
  const series = a?.series ?? [];

  const mixData = [
    { name: "Messages", value: a?.messages ?? 0 },
    { name: "InMails", value: a?.inmails ?? 0 },
    { name: "Engagements", value: a?.engagements ?? 0 },
  ];
  const mixTotal = mixData.reduce((s, x) => s + x.value, 0);

  const funnelSteps = [
    { label: "Invites", value: a?.connections ?? 0, color: CORAL },
    {
      label: "Accepted",
      value: a?.acceptedInvites ?? 0,
      color: BLUE,
      conversion: `${a?.acceptanceRate ?? 0}% accepted`,
    },
    {
      label: "Conversations",
      value: a?.conversations ?? 0,
      color: GREEN,
      conversion: `${pct(a?.conversations ?? 0, a?.acceptedInvites ?? 0)}% in conversation`,
    },
    {
      label: "Replies",
      value: a?.replies ?? 0,
      color: VIOLET,
      conversion: `${pct(a?.replies ?? 0, a?.conversations ?? 0)}% replied`,
    },
  ];
  const funnelTotal = funnelSteps.reduce((s, x) => s + x.value, 0);

  const topCampaigns = [...campaigns]
    .filter((c) => (c.metrics?.sent ?? 0) > 0)
    .sort((x, y) => (y.metrics?.acceptRate ?? 0) - (x.metrics?.acceptRate ?? 0))
    .slice(0, 3);

  const avgHealth =
    accounts.length > 0
      ? Math.round(accounts.reduce((s, acc) => s + (acc.health_score ?? 0), 0) / accounts.length)
      : 0;
  const health = overallHealth(accounts);

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-[18px]">
      {/* Greeting + date range */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {greeting}, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s how your outreach is performing across all campaigns.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-xl border bg-card">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cn(
                "px-3.5 py-2 text-xs font-semibold transition-colors",
                range === r.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* HERO — replies headline + trend, beside the account-safety ring */}
      <div className="flex flex-wrap items-stretch gap-5 lg:flex-nowrap">
        <div className="min-w-[300px] flex-1 rounded-[20px] border border-border bg-card p-7">
          <div className="text-[11px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
            Replies · {RANGE_LABEL[range]}
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="font-display text-[50px] font-bold leading-[0.9] tracking-tight text-foreground">
              {(a?.replies ?? 0).toLocaleString()}
            </span>
            <span className="pb-2 text-[17px] font-semibold text-muted-foreground">replies</span>
            {typeof d?.replies === "number" ? <DeltaPill value={d.replies} /> : null}
          </div>
          <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-muted-foreground">
            From <strong className="text-foreground">{(a?.connections ?? 0).toLocaleString()} invites</strong> at a{" "}
            {a?.acceptanceRate ?? 0}% acceptance rate — {(a?.conversations ?? 0).toLocaleString()} conversations in this
            period.
          </p>
          <div className="mt-4">
            <HeroAreaChart values={series.map((p) => p.replies)} color={CORAL} />
            <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground/70">
              <span>{series[0]?.date ? shortDate(series[0].date) : ""}</span>
              <span>Today</span>
            </div>
          </div>
          <div className="mt-5 flex gap-0 border-t border-border pt-5">
            <HeroStat label="Invites sent" value={(a?.connections ?? 0).toLocaleString()} />
            <div className="w-px bg-border" />
            <HeroStat label="Acceptance" value={`${a?.acceptanceRate ?? 0}%`} />
            <div className="w-px bg-border" />
            <HeroStat label="Reply rate" value={`${a?.replyRate ?? 0}%`} />
          </div>
        </div>

        {/* Account safety — first-class health ring beside the hero */}
        <div className="flex w-full flex-col rounded-[20px] border border-border bg-card p-6 lg:w-[286px]">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="size-[15px] text-success" />
            Account safety
          </div>
          {hasAccount ? (
            <>
              <div className="mt-4 flex items-center gap-4">
                <HealthRing score={avgHealth} size={96} />
                <div>
                  <Badge variant={health.tone} dot>
                    {health.label}
                  </Badge>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                    {accounts.length} connected account{accounts.length === 1 ? "" : "s"}, all paced within safe limits.
                  </p>
                </div>
              </div>
              <div className="mt-auto flex gap-1.5 pt-4">
                {accounts.slice(0, 6).map((acc, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-[5px] flex-1 rounded-full",
                      acc.status === "restricted"
                        ? "bg-destructive"
                        : acc.status === "warming" || acc.status === "paused"
                          ? "bg-warning"
                          : "bg-success",
                    )}
                  />
                ))}
              </div>
              <Link
                href="/settings/accounts"
                className="mt-2.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Manage accounts &rarr;
              </Link>
            </>
          ) : (
            <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
              No accounts connected yet.{" "}
              <Link href="/settings/accounts" className="font-medium text-primary hover:underline">
                Connect one
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      {/* KPI tiles with sparklines */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Invites sent"
          value={(a?.connections ?? 0).toLocaleString()}
          delta={d?.connections ?? null}
          series={series.map((p) => p.invites)}
          color={CORAL}
        />
        <KpiTile
          label="Acceptance"
          value={`${a?.acceptanceRate ?? 0}%`}
          delta={d?.acceptedInvites ?? null}
          series={series.map((p) => p.accepted)}
          color={GREEN}
        />
        <KpiTile
          label="Reply rate"
          value={`${a?.replyRate ?? 0}%`}
          delta={d?.replies ?? null}
          series={series.map((p) => p.replies)}
          color={BLUE}
        />
        <KpiTile
          label="Conversations"
          value={(a?.conversations ?? 0).toLocaleString()}
          delta={d?.conversations ?? null}
          series={series.map((p) => p.messages)}
          color={VIOLET}
        />
      </div>

      {/* Two-column body */}
      <div className="grid items-start gap-[18px] lg:grid-cols-3">
        <div className="space-y-[18px] lg:col-span-2">
          {/* Funnel */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Outreach funnel</CardTitle>
              <Badge variant="muted">All campaigns · {range === "all" ? "all time" : range}</Badge>
            </CardHeader>
            <CardContent>
              {funnelTotal > 0 ? (
                <HorizontalFunnel steps={funnelSteps} />
              ) : (
                <EmptyChart label="No activity in this period — start a campaign to see your funnel." />
              )}
            </CardContent>
          </Card>

          {/* Outreach mix */}
          <Card>
            <CardHeader>
              <CardTitle>Outreach mix</CardTitle>
            </CardHeader>
            <CardContent>
              {mixTotal > 0 ? (
                <div className="flex flex-wrap items-center gap-6">
                  <div className="w-[220px] max-w-full">
                    <MixDonut data={mixData} />
                  </div>
                  <div className="flex min-w-[200px] flex-1 flex-col gap-3">
                    {mixData.map((x, i) => (
                      <div key={x.name} className="flex items-center gap-2.5 text-sm">
                        <span
                          className="size-2.5 rounded-[3px]"
                          style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="text-muted-foreground">{x.name}</span>
                        <span className="ml-auto font-display font-bold">{x.value.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyChart label="No actions sent yet." />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right rail */}
        <aside className="space-y-[18px]">
          {/* Unit economics — AI spend per outcome (is the engine profitable?). */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Unit economics</CardTitle>
              <DollarSign className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              {econ && econ.totalSpendUsd > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="font-display text-[28px] font-bold leading-none tracking-tight text-primary">
                        {formatUsd(econ.costPerBookedMeetingUsd)}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">per booked meeting</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg font-bold">{formatUsd(econ.costPerConversationUsd)}</div>
                      <div className="text-[11px] text-muted-foreground">per conversation</div>
                    </div>
                  </div>
                  <div className="flex justify-between border-t pt-2 text-xs text-muted-foreground">
                    <span>{formatUsd(econ.totalSpendUsd)} AI spend</span>
                    <span>{econ.bookedMeetings.toLocaleString()} booked</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No AI spend in this period yet. Cost per booked meeting appears once the AI engages
                  replies and conversations reach the booked stage.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Top campaigns */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Top campaigns</CardTitle>
              <Link href="/campaigns" className="text-xs font-semibold text-primary hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {topCampaigns.length > 0 ? (
                <div className="space-y-3.5">
                  {topCampaigns.map((c) => (
                    <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="truncate text-sm font-semibold">{c.name}</span>
                        <span className="ml-2 shrink-0 text-xs font-bold text-success">
                          {c.metrics?.acceptRate ?? 0}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(c.metrics?.acceptRate ?? 0, 100)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {c.leadCount.toLocaleString()} leads · acceptance
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No campaigns with activity yet.</p>
              )}
            </CardContent>
          </Card>

          {!allDone ? (
            <Card>
              <CardHeader>
                <CardTitle>Get started</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ChecklistItem done={hasAccount} label="Connect a LinkedIn account" href="/settings/accounts" />
                <ChecklistItem done={hasCampaign} label="Create a campaign" href="/campaigns" />
                <ChecklistItem
                  done={hasConversation}
                  label="Reply to your first lead"
                  href="/inbox"
                  icon={Inbox}
                />
              </CardContent>
            </Card>
          ) : null}

          {a && a.tags.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Top tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {a.tags.map((t) => (
                    <Badge key={t.tag} variant="secondary">
                      {t.tag}
                      <span className="text-muted-foreground">{t.count}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-[26px] first:pl-0">
      <div className="font-display text-[19px] font-bold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  delta,
  series,
  color,
}: {
  label: string;
  value: string;
  delta: number | null;
  series: number[];
  color: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-[18px] shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-muted-foreground">{label}</span>
        {typeof delta === "number" ? <DeltaPill value={delta} /> : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2.5">
        <span className="font-display text-[28px] font-bold leading-none tracking-tight">{value}</span>
        <Sparkline values={series} color={color} />
      </div>
    </div>
  );
}

function DeltaPill({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold",
        up ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
      )}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(value)}%
    </span>
  );
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
      <ShieldCheck className="size-6 text-muted-foreground/40" />
      <p className="mt-2 max-w-[16rem] text-sm text-muted-foreground">{label}</p>
    </div>
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
        "flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-accent",
        done && "opacity-70",
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
      <span className={cn("text-sm font-medium", done && "line-through")}>{label}</span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-[18px]">
      <div className="flex items-end justify-between">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-44 rounded-xl" />
      </div>
      <Skeleton className="h-[210px] rounded-[20px]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-[18px] lg:grid-cols-3">
        <div className="space-y-[18px] lg:col-span-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <div className="space-y-[18px]">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
