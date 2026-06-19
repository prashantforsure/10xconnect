"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

interface AffiliateData {
  referralCode: string;
  referralUrl: string;
  stats: { clicks: number; signups: number; earningsUsd: number };
  payoutRatePct: number;
}

export function AffiliateClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [data, setData] = useState<AffiliateData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      setData(await api.request<AffiliateData>("/affiliate"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }
  if (loading || !data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="surface-card p-6">
        <h2 className="font-display text-base font-semibold">Your referral link</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Earn {data.payoutRatePct}% recurring on every paid referral.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg bg-secondary px-2.5 py-1.5 text-xs">
            {data.referralUrl}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(data.referralUrl)}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Clicks" value={data.stats.clicks} tint="bg-tint-blue" />
        <Stat label="Signups" value={data.stats.signups} tint="bg-tint-green" />
        <Stat label="Earnings" value={`$${data.stats.earningsUsd}`} tint="bg-tint-coral" />
      </div>
    </div>
  );
}

function Stat({ label, value, tint }: { label: string; value: number | string; tint?: string }) {
  return (
    <div className={cn("rounded-2xl border p-5 shadow-soft", tint ?? "bg-card")}>
      <div className="font-display text-2xl font-bold tracking-tight text-foreground">{value}</div>
      <div className="text-xs text-foreground/60">{label}</div>
    </div>
  );
}
