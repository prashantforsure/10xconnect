"use client";

import { Clock, DollarSign } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
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

export function AnalyticsTab({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [data, setData] = useState<CampaignAnalytics | null>(null);
  const [econ, setEcon] = useState<UnitEconomics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.request<CampaignAnalytics>(`/analytics/campaign/${campaignId}`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
    // Unit economics is non-blocking — the page renders even if it fails.
    api
      .request<UnitEconomics>(`/analytics/campaign/${campaignId}/unit-economics`)
      .then(setEcon)
      .catch(() => setEcon(null));
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">No analytics yet.</p>;
  }

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Past actions</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />~15s intervals (testing)
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
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
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
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
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
