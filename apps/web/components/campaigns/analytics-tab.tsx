"use client";

import { Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api/client";
import { nodeLabel } from "@/lib/campaigns/nodes";

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
        <Stat label="Accepted invites" value={data.acceptedInvites.count} pct={data.acceptedInvites.pct} />
        <Stat label="Messages" value={data.messages} />
        <Stat label="Replies" value={data.replies.count} pct={data.replies.pct} />
        <Stat label="Likes" value={data.likes} />
        <Stat label="Comments" value={data.comments} />
        <Stat label="InMails" value={data.inmails} />
        <Stat label="Voice notes" value={data.voiceNotes} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Past actions</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />~15-min intervals
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

function Stat({ label, value, pct }: { label: string; value: number; pct?: number }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tracking-tight">{value.toLocaleString()}</span>
        {typeof pct === "number" ? <Badge variant="success">{pct}%</Badge> : null}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
