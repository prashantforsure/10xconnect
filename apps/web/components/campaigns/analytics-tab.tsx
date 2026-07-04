"use client";

import { CalendarClock, Clock, DollarSign, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api/client";
import { nodeLabel } from "@/lib/campaigns/nodes";
import { formatUsd, type UnitEconomics } from "@/lib/campaigns/unit-economics";
import { cn } from "@/lib/utils";

interface CampaignAnalytics {
  requests: number;
  messages: number;
  acceptedInvites: { count: number; pct: number };
  replies: { count: number; pct: number };
  openMessages: number;
  likes: number;
  comments: number;
  inmails: number;
  voiceNotes: number;
  pastActions: { type: string; status: string; at: string | null; lead: string }[];
}

interface UpcomingActions {
  total: number;
  actions: { type: string; at: string | null; lead: string }[];
}

// Silent auto-refresh cadence (metrics update as the dispatcher works through the
// queue). 30s keeps the tab feeling live without hammering the API.
const REFRESH_MS = 30_000;

export function AnalyticsTab({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [data, setData] = useState<CampaignAnalytics | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingActions | null>(null);
  const [econ, setEcon] = useState<UnitEconomics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `silent` refreshes (polling / manual) don't flash the "Loading…" state.
  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await api.request<CampaignAnalytics>(`/analytics/campaign/${campaignId}`);
        if (mountedRef.current) setData(next);
      } catch {
        if (mountedRef.current && !opts?.silent) setData(null);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
      // Unit economics + the dispatch queue are non-blocking — the page renders
      // even if either fails.
      api
        .request<UnitEconomics>(`/analytics/campaign/${campaignId}/unit-economics`)
        .then((e) => mountedRef.current && setEcon(e))
        .catch(() => mountedRef.current && setEcon(null));
      api
        .request<UpcomingActions>(`/campaigns/${campaignId}/upcoming`)
        .then((u) => mountedRef.current && setUpcoming(u))
        .catch(() => mountedRef.current && setUpcoming(null));
    },
    [api, campaignId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Poll silently while the tab is mounted so metrics stay fresh during a run.
  useEffect(() => {
    const id = setInterval(() => void load({ silent: true }), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">No analytics yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Live metrics — auto-refreshing. Campaigns dispatch every 4–8 minutes (randomized) to stay human.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load({ silent: true })}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="LinkedIn requests" value={data.requests} />
        <Stat
          label="Accepted invites"
          value={data.acceptedInvites.count}
          pct={data.acceptedInvites.pct}
          accent="success"
        />
        <Stat label="Messages" value={data.messages} />
        <Stat label="Replies" value={data.replies.count} pct={data.replies.pct} accent="primary" />
        <Stat label="Likes" value={data.likes} />
        <Stat label="Comments" value={data.comments} />
        <Stat label="InMails" value={data.inmails} />
        <Stat label="Voice notes" value={data.voiceNotes} />
      </div>

      {econ ? <UnitEconomicsCard econ={econ} /> : null}

      {/* Forward-looking queue — answers "is it working?" before anything has sent. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Upcoming actions</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" />
            {upcoming ? `${upcoming.total} queued` : "—"}
          </span>
        </CardHeader>
        <CardContent>
          {!upcoming || upcoming.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing queued — the campaign is stopped, completed, or waiting on its schedule.
            </p>
          ) : (
            <div className="divide-y rounded-xl border text-sm">
              {upcoming.actions.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{nodeLabel(a.type)}</span> →{" "}
                    <span className="text-muted-foreground">{a.lead}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.at ? new Date(a.at).toLocaleString() : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Past actions</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            Most recent first
          </span>
        </CardHeader>
        <CardContent>
          {data.pastActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions dispatched yet.</p>
          ) : (
            <div className="divide-y rounded-xl border text-sm">
              {data.pastActions.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{nodeLabel(a.type)}</span> →{" "}
                    <span className="text-muted-foreground">{a.lead}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.at ? new Date(a.at).toLocaleString() : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UnitEconomicsCard({ econ }: { econ: UnitEconomics }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Unit economics</CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <DollarSign className="size-3.5" />
          AI spend per outcome
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="AI spend" money value={econ.totalSpendUsd} />
          <Money label="Cost / conversation" value={econ.costPerConversationUsd} />
          <Money label="Cost / booked meeting" value={econ.costPerBookedMeetingUsd} highlight />
          <Stat label="Booked meetings" value={econ.bookedMeetings} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {econ.bookedMeetings > 0
            ? `${formatUsd(econ.costPerBookedMeetingUsd)} per booked meeting decides whether the AI pays for itself.`
            : "Cost per booked meeting appears once a conversation reaches the “booked” stage in the inbox."}
        </p>
      </CardContent>
    </Card>
  );
}

/** A money KPI that reads “—” until the ratio is defined (no division by zero). */
function Money({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-soft">
      <div
        className={
          "font-display text-2xl font-bold tracking-tight" + (highlight ? " text-primary" : "")
        }
      >
        {value == null ? "—" : formatUsd(value)}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  pct,
  money,
  accent,
}: {
  label: string;
  value: number;
  pct?: number;
  money?: boolean;
  /** Tints the headline value — used to keep safety KPIs (accept/reply rate) first-class. */
  accent?: "success" | "primary";
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-soft">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-display text-2xl font-bold tracking-tight",
            accent === "success" && "text-success",
            accent === "primary" && "text-primary",
          )}
        >
          {money ? formatUsd(value) : value.toLocaleString()}
        </span>
        {typeof pct === "number" ? (
          <Badge variant={accent === "primary" ? "default" : "success"}>{pct}%</Badge>
        ) : null}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
