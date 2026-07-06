"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/loader";
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
    return <PageLoader />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="Earnings" value={`$${data.stats.earningsUsd}`} accent />
        <Stat label="Signups" value={data.stats.signups} />
        <Stat label="Clicks" value={data.stats.clicks} />
        <Stat label="Commission" value={`${data.payoutRatePct}%`} />
      </div>

      <div className="surface-card p-5">
        <div className="mb-2.5 text-[15px] font-semibold text-foreground">
          Your referral link
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Earn {data.payoutRatePct}% recurring on every paid referral.
        </p>
        <div className="flex items-center gap-2.5 rounded-md border border-input bg-inset px-3.5 py-2.5">
          <code className="flex-1 break-all font-mono text-[13px] font-medium text-foreground">
            {data.referralUrl}
          </code>
          <Button
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(data.referralUrl)}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="surface-card p-[18px]">
      <div
        className={cn(
          "text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
          accent ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/40">{label}</div>
    </div>
  );
}
