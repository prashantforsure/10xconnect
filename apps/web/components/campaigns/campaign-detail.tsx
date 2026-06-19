"use client";

import { auditAccountProfile, type ProfileAuditItem } from "@10xconnect/core";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Info, Play, Share2, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AnalyticsTab } from "@/components/campaigns/analytics-tab";
import { BuilderTab } from "@/components/campaigns/builder-tab";
import { LeadsTab } from "@/components/campaigns/leads-tab";
import { SettingsTab } from "@/components/campaigns/settings-tab";
import { type CampaignStatus, CampaignStatusBadge } from "@/components/campaigns/status-badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

export interface CampaignDetailView {
  id: string;
  name: string;
  status: CampaignStatus;
  accountId: string | null;
  settings: { skip_already_contacted: boolean; exclude_conn_req_from_reply_rate: boolean };
  leadCount: number;
}

interface AccountOption {
  id: string;
  name: string | null;
  status: string;
}

interface CampaignMetricsSummary {
  requests: number;
  messages: number;
  acceptedInvites: { count: number; pct: number };
  replies: { count: number; pct: number };
}

const TABS = ["builder", "leads", "analytics", "settings"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  builder: "Sequence",
  leads: "Leads",
  analytics: "Analytics",
  settings: "Settings",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [campaign, setCampaign] = useState<CampaignDetailView | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [metrics, setMetrics] = useState<CampaignMetricsSummary | null>(null);
  const [tab, setTab] = useState<Tab>("builder");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditItems, setAuditItems] = useState<ProfileAuditItem[]>([]);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [c, accs] = await Promise.all([
        api.request<CampaignDetailView>(`/campaigns/${campaignId}`),
        api.request<AccountOption[]>("/accounts"),
      ]);
      setCampaign(c);
      setAccounts(accs);
      // Header metric strip — non-blocking; the page renders even if this fails.
      api
        .request<CampaignMetricsSummary>(`/analytics/campaign/${campaignId}`)
        .then(setMetrics)
        .catch(() => undefined);
    } catch (err) {
      setError(errorMessage(err, "Could not load campaign"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const bindAccount = async (accountId: string): Promise<void> => {
    setActionError(null);
    try {
      await api.request(`/campaigns/${campaignId}`, {
        method: "PATCH",
        body: { accountId: accountId || null },
      });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not set account"));
    }
  };

  // Pre-launch profile-readiness audit (advisory, §6). Opens a checklist before
  // the first launch; the user can always proceed.
  const requestRun = (): void => {
    const acc = accounts.find((a) => a.id === campaign?.accountId);
    setAuditItems(
      auditAccountProfile({
        name: acc?.name ?? null,
        status: acc?.status ?? (campaign?.accountId ? null : "no account bound"),
      }),
    );
    setAuditOpen(true);
  };

  const run = async (): Promise<void> => {
    setAuditOpen(false);
    setBusy(true);
    setActionError(null);
    try {
      await api.request(`/campaigns/${campaignId}/start`, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not start campaign"));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await api.request(`/campaigns/${campaignId}/stop`, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not stop campaign"));
    } finally {
      setBusy(false);
    }
  };

  const share = async (): Promise<void> => {
    try {
      const res = await api.request<{ url: string }>(`/campaigns/${campaignId}/share`, { method: "POST" });
      setShareUrl(res.url);
      await navigator.clipboard?.writeText(res.url).catch(() => undefined);
    } catch (err) {
      setActionError(errorMessage(err, "Could not create share link"));
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading campaign…</div>;
  }
  if (error || !campaign) {
    return <div className="p-8 text-sm text-destructive">{error ?? "Campaign not found"}</div>;
  }

  const isRunning = campaign.status === "running";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <Link
        href="/campaigns"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Campaigns
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{campaign.name}</h1>
        <CampaignStatusBadge status={campaign.status} />
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={campaign.accountId ?? ""}
            onChange={(e) => void bindAccount(e.target.value)}
            className="h-9 w-auto min-w-[12rem]"
          >
            <option value="">No account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? "LinkedIn account"} ({a.status})
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => void share()}>
            <Share2 />
            Share
          </Button>
          {isRunning ? (
            <Button variant="destructive" onClick={() => void stop()} disabled={busy}>
              <Square />
              Stop
            </Button>
          ) : (
            <Button onClick={requestRun} disabled={busy}>
              <Play />
              Run it!
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Pre-launch profile check"
        description="A quick, optional readiness check — these don't block your launch."
      >
        <div className="space-y-3">
          <ul className="space-y-2">
            {auditItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                {item.severity === "warn" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                ) : item.severity === "info" ? (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                )}
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAuditOpen(false)} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? "Starting…" : "Run anyway"}
            </Button>
          </div>
        </div>
      </Modal>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3" />
        Campaigns run automatically in ~15-minute intervals on average to avoid detection.
      </p>

      {actionError ? (
        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}
      {shareUrl ? (
        <div className="mt-3 rounded-xl border bg-secondary/50 px-3 py-2 text-sm">
          Share link copied: <span className="font-mono text-xs">{shareUrl}</span>
        </div>
      ) : null}

      {/* Metric strip */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3 lg:grid-cols-5">
        <MetricCell label="Leads" value={campaign.leadCount.toLocaleString()} />
        <MetricCell label="Sent" value={(metrics?.requests ?? 0).toLocaleString()} />
        <MetricCell label="Accepted" value={(metrics?.acceptedInvites.count ?? 0).toLocaleString()} />
        <MetricCell
          label="Accept rate"
          value={`${metrics?.acceptedInvites.pct ?? 0}%`}
          tone="success"
        />
        <MetricCell label="Replies" value={(metrics?.replies.count ?? 0).toLocaleString()} tone="primary" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="builder">
          <BuilderTab campaignId={campaignId} running={isRunning} accounts={accounts} />
        </TabsContent>
        <TabsContent value="leads">
          <LeadsTab campaignId={campaignId} />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab campaignId={campaignId} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab campaignId={campaignId} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "primary";
}) {
  return (
    <div className="bg-card px-4 py-3.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={
          "font-display text-[19px] font-bold tracking-tight" +
          (tone === "success" ? " text-success" : tone === "primary" ? " text-primary" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
