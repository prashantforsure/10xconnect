"use client";

import {
  auditAccountProfile,
  computeRequiredInputs,
  type GenNode,
  hasCampaignBrain,
  launchReadiness,
  type ProfileAuditItem,
  type RequiredInput,
} from "@10xconnect/core";
import { AlertTriangle, ArrowLeft, BookmarkPlus, CheckCircle2, Clock, CopyPlus, Info, Play, Share2, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AnalyticsTab } from "@/components/campaigns/analytics-tab";
import { BuilderTab } from "@/components/campaigns/builder-tab";
import { ContextTab } from "@/components/campaigns/context-tab";
import { DuplicateCampaignModal } from "@/components/campaigns/duplicate-campaign-modal";
import { LeadsTab } from "@/components/campaigns/leads-tab";
import { SettingsTab } from "@/components/campaigns/settings-tab";
import { type CampaignStatus, CampaignStatusBadge } from "@/components/campaigns/status-badge";
import { SaveAsTemplateModal } from "@/components/campaigns/templates";
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

const TABS = ["builder", "leads", "context", "analytics", "settings"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  builder: "Sequence",
  leads: "Leads",
  context: "Context",
  analytics: "Analytics",
  settings: "Settings",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const router = useRouter();
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
  const [aiOff, setAiOff] = useState<boolean | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [readiness, setReadiness] = useState<{ ready: boolean; missing: RequiredInput[] } | null>(null);
  // Latest campaign for the readiness check without re-creating the callback.
  const campaignRef = useRef<CampaignDetailView | null>(null);
  campaignRef.current = campaign;

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

  // Compute the AI-off banner + launch readiness from the LIVE campaign state.
  // hasCampaignBrain mirrors the inbound gate (does the AI engage replies?);
  // launchReadiness mirrors the blueprint gate (account + contacts + grounding
  // before launch). Re-checked on tab change and whenever account/leadCount change.
  const checkGate = useCallback(async () => {
    try {
      const [brain, seq, kbs] = await Promise.all([
        api.request<{ objective: unknown; knowledgeBaseId: string | null; voiceProfileId: string | null }>(
          `/campaigns/${campaignId}/brain`,
        ),
        api.request<{ nodes: { kind: "action" | "condition"; type: string; config: Record<string, unknown> }[] }>(
          `/campaigns/${campaignId}/sequence`,
        ),
        api.request<{ id: string; chunks: number }[]>("/knowledge-bases"),
      ]);
      setAiOff(!hasCampaignBrain({ objective: brain.objective, knowledgeBaseId: brain.knowledgeBaseId }));
      const graph: GenNode[] = seq.nodes.map((n) => ({ kind: n.kind, type: n.type, config: n.config }));
      const linkedKb = kbs.find((k) => k.id === brain.knowledgeBaseId);
      const c = campaignRef.current;
      setReadiness(
        launchReadiness(computeRequiredInputs(graph), {
          sender_account: Boolean(c?.accountId),
          contacts: (c?.leadCount ?? 0) > 0,
          // A knowledge base only counts once it has real facts (chunks), not just a shell.
          knowledge_base: Boolean(linkedKb && linkedKb.chunks > 0),
          voice_profile: Boolean(brain.voiceProfileId),
        }),
      );
    } catch {
      setReadiness(null);
    }
  }, [api, campaignId]);
  useEffect(() => {
    void checkGate();
  }, [tab, checkGate, campaign?.accountId, campaign?.leadCount]);

  // Inline fix-it links for a missing launch input.
  const readinessAction = (key: RequiredInput["key"]): React.ReactNode => {
    if (key === "contacts") {
      return (
        <button type="button" onClick={() => setTab("leads")} className="text-primary hover:underline">
          Add contacts
        </button>
      );
    }
    if (key === "knowledge_base") {
      return (
        <button type="button" onClick={() => setTab("context")} className="text-primary hover:underline">
          Add facts
        </button>
      );
    }
    if (key === "voice_profile") {
      return (
        <Link href="/settings/voice-cloner" className="text-primary hover:underline">
          Set up voice
        </Link>
      );
    }
    return null; // sender_account: the account selector is in the header above
  };

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
          <Button variant="outline" onClick={() => setDuplicateOpen(true)}>
            <CopyPlus />
            Duplicate
          </Button>
          <Button variant="outline" onClick={() => setSaveTemplateOpen(true)}>
            <BookmarkPlus />
            Save as template
          </Button>
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
            <Button
              onClick={requestRun}
              // Fail closed: stay disabled until readiness is known AND ready.
              disabled={busy || !readiness?.ready}
              title={
                readiness && !readiness.ready
                  ? "Add the required inputs below before launching"
                  : undefined
              }
            >
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

      <SaveAsTemplateModal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        campaignId={campaignId}
        defaultName={campaign.name}
      />

      <DuplicateCampaignModal
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        campaignId={campaignId}
        defaultName={`${campaign.name} (copy)`}
        onDuplicated={(newId) => {
          setDuplicateOpen(false);
          router.push(`/campaigns/${newId}`);
        }}
      />

      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3" />
        Testing mode: campaigns run automatically every ~15 seconds so you can see results fast. Your
        daily limits per account are always respected.
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

      {/* Launch readiness — the campaign can't go live until these are supplied (§13). */}
      {!isRunning && readiness && !readiness.ready ? (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0 text-warning-foreground" />
            Before you can launch, add:
          </div>
          <ul className="mt-1.5 space-y-1">
            {readiness.missing.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-x-2">
                <span className="text-muted-foreground">• {m.label}</span>
                {readinessAction(m.key)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* AI-off indicator — the AI won't engage replies until a brain is set (§5.7).
          Hidden on the Context tab, which shows its own in-tab banner. */}
      {aiOff && tab !== "context" ? (
        <button
          type="button"
          onClick={() => setTab("context")}
          className="mt-4 flex w-full items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-left text-sm transition-colors hover:bg-warning/20"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
          <span>
            <span className="font-medium">AI replies are off.</span>{" "}
            <span className="text-muted-foreground">
              This campaign has no aim or knowledge base, so the AI won&apos;t engage replies. Open the
              Context tab to configure it →
            </span>
          </span>
        </button>
      ) : null}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="builder" forceMount>
          {/* A graph change (incl. Build-with-AI apply) refreshes the gate from the saved sequence. */}
          <BuilderTab
            campaignId={campaignId}
            running={isRunning}
            accounts={accounts}
            onChanged={() => void checkGate()}
          />
        </TabsContent>
        <TabsContent value="leads">
          {/* Enrolling/removing contacts changes leadCount → reload so the gate updates. */}
          <LeadsTab
            campaignId={campaignId}
            campaignName={campaign?.name ?? ""}
            onChanged={() => void load()}
          />
        </TabsContent>
        <TabsContent value="context">
          <ContextTab campaignId={campaignId} />
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
