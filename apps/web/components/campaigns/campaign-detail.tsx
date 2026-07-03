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
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  CheckCircle2,
  CopyPlus,
  Info,
  MoreHorizontal,
  Pause,
  Play,
  Share2,
  Square,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

export interface CampaignDetailView {
  id: string;
  name: string;
  status: CampaignStatus;
  accountId: string | null;
  settings: {
    skip_already_contacted: boolean;
    exclude_conn_req_from_reply_rate: boolean;
    pause_ai_replies?: boolean;
  };
  leadCount: number;
}

interface AccountOption {
  id: string;
  type: "linkedin" | "mailbox";
  name: string | null;
  label: string | null;
  status: string;
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

/** "fires ~2:06 PM" (with the day when it isn't today) for the launch/resume flash. */
function firstActionLabel(iso: string | null): string {
  if (!iso) {
    return "the first action will be scheduled inside your working hours";
  }
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) {
    return `first action fires ~${time}`;
  }
  const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `first action fires ${day} ~${time}`;
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();

  const [campaign, setCampaign] = useState<CampaignDetailView | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [tab, setTab] = useState<Tab>("builder");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  // Transient success line (e.g. "Scheduled 12 leads") shown in the notices strip.
  const [flash, setFlash] = useState<string | null>(null);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [pauseAiToo, setPauseAiToo] = useState(false);
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

  // While the campaign is live, poll its status so auto-transitions (auto-complete
  // when the last lead finishes, auto-pause on account trouble) surface here
  // instead of happening silently — the top P0 in the campaign UX audit.
  useEffect(() => {
    const status = campaign?.status;
    if (status !== "running" && status !== "paused") {
      return;
    }
    const id = setInterval(() => {
      api
        .request<{ status: CampaignStatus }>(`/campaigns/${campaignId}/status`)
        .then((s) => {
          const current = campaignRef.current?.status;
          if (!current || s.status === current) {
            return;
          }
          if (s.status === "completed") {
            setFlash("Campaign completed — every enrolled lead has finished the sequence.");
          } else if (s.status === "paused") {
            setFlash("Campaign was paused — check your sending account's health, then Resume.");
          }
          void load();
        })
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [api, campaignId, campaign?.status, load]);

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
    setFlash(null);
    try {
      const res = await api.request<{ status: string; scheduled: number; nextActionAt: string | null }>(
        `/campaigns/${campaignId}/start`,
        { method: "POST" },
      );
      setFlash(
        res.scheduled > 0
          ? `Scheduled ${res.scheduled} lead${res.scheduled === 1 ? "" : "s"} — ${firstActionLabel(res.nextActionAt)}.`
          : "Campaign started. Enroll leads to begin outreach.",
      );
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not start campaign"));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setStopConfirmOpen(false);
    setBusy(true);
    setActionError(null);
    setFlash(null);
    try {
      await api.request(`/campaigns/${campaignId}/stop`, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not stop campaign"));
    } finally {
      setBusy(false);
    }
  };

  const pause = async (silenceAi: boolean): Promise<void> => {
    setPauseConfirmOpen(false);
    setBusy(true);
    setActionError(null);
    setFlash(null);
    try {
      // Record the AI choice first so the dispatch gate sees it the moment the
      // campaign flips to paused (settings are merged, not replaced).
      await api.request(`/campaigns/${campaignId}`, {
        method: "PATCH",
        body: JSON.stringify({ settings: { pause_ai_replies: silenceAi } }),
      });
      await api.request(`/campaigns/${campaignId}/pause`, { method: "POST" });
      setFlash(
        silenceAi
          ? "Campaign paused — the sequence is frozen and AI replies are held until you Resume."
          : "Campaign paused — the sequence is frozen, but the AI keeps answering leads who reply. Resume to pick up where each lead left off.",
      );
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not pause campaign"));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    setFlash(null);
    try {
      const res = await api.request<{ status: string; scheduled: number; nextActionAt: string | null }>(
        `/campaigns/${campaignId}/resume`,
        { method: "POST" },
      );
      setFlash(
        `Resumed — ${res.scheduled} lead${res.scheduled === 1 ? "" : "s"} re-queued from where they left off; ${firstActionLabel(res.nextActionAt)}.`,
      );
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not resume campaign"));
    } finally {
      setBusy(false);
    }
  };

  const share = async (): Promise<void> => {
    try {
      const res = await api.request<{ url: string }>(`/campaigns/${campaignId}/share`, { method: "POST" });
      setShareUrl(res.url);
      let copied = false;
      try {
        await navigator.clipboard?.writeText(res.url);
        copied = true;
      } catch {
        // Clipboard blocked (permissions / insecure context) — we surface the URL to copy manually.
      }
      setShareCopied(copied);
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
  const isPaused = campaign.status === "paused";
  // Running OR paused = "in flight": the sequence is locked (leads are parked on
  // nodes; editing/deleting them would strand leads). Only stop/resume unlocks it.
  const isActive = isRunning || isPaused;
  const hasNotice =
    Boolean(actionError) ||
    Boolean(flash) ||
    Boolean(shareUrl) ||
    (Boolean(aiOff) && tab !== "context");

  return (
    // Full-height, full-bleed app layout (matches the Command Dark mockup): a
    // compact tab + action bar, then a content area that fills the viewport.
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab + action bar — name + status, tabs, then one primary + ⋯ overflow. */}
      <div className="flex h-[54px] flex-shrink-0 items-center gap-3 border-b border-border pl-4 pr-[22px]">
        <Link
          href="/campaigns"
          aria-label="Back to campaigns"
          className="-ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <span className="max-w-[180px] truncate font-display text-[15px] font-semibold text-foreground">
          {campaign.name}
        </span>
        <CampaignStatusBadge status={campaign.status} />

        <div className="mx-1 h-5 w-px bg-border" />

        {/* Tabs — inline, with a coral underline on the active tab. */}
        <div className="flex h-full items-stretch">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "relative inline-flex items-center px-3 text-[13px] font-semibold transition-colors",
                tab === t
                  ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Actions — account selector, one primary (Run/Stop), ⋯ overflow. */}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={campaign.accountId ?? ""}
            onChange={(e) => void bindAccount(e.target.value)}
            className="h-9 w-auto min-w-[9rem] text-[12.5px]"
            aria-label="Sending account"
          >
            <option value="">No account</option>
            {accounts
              .filter((a) => a.type === "linkedin")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label ?? a.name ?? "LinkedIn account"} ({a.status})
                </option>
              ))}
          </Select>
          {isActive ? (
            <>
              {isPaused ? (
                <Button size="sm" onClick={() => void resume()} disabled={busy}>
                  <Play />
                  Resume
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPauseAiToo(campaign.settings.pause_ai_replies === true);
                    setPauseConfirmOpen(true);
                  }}
                  disabled={busy}
                >
                  <Pause />
                  Pause
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setStopConfirmOpen(true)}
                disabled={busy}
              >
                <Square />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={requestRun}
              // Fail closed: stay disabled until readiness is known AND ready.
              disabled={busy || !readiness?.ready}
              title={
                readiness && !readiness.ready
                  ? `Add before launching: ${readiness.missing.map((m) => m.label).join(", ")}`
                  : undefined
              }
            >
              <Play />
              Run it!
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void share()}>
                <Share2 />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSaveTemplateOpen(true)}>
                <BookmarkPlus />
                Save as template
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>
                <CopyPlus />
                Duplicate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Slim conditional notices — errors, share link, launch readiness, AI-off. */}
      {hasNotice ? (
        <div className="flex flex-shrink-0 flex-col gap-2 border-b border-border px-5 py-3">
          {actionError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          ) : null}
          {flash ? (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
              {flash}
            </div>
          ) : null}
          {shareUrl ? (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
              {shareCopied ? "Share link copied:" : "Share link ready — copy it:"}{" "}
              <span className="font-mono text-xs text-muted-foreground">{shareUrl}</span>
            </div>
          ) : null}
          {aiOff && tab !== "context" ? (
            <button
              type="button"
              onClick={() => setTab("context")}
              className="flex w-full items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left text-sm transition-colors hover:bg-warning/20"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <span className="font-medium">AI replies are off.</span>{" "}
                <span className="text-muted-foreground">
                  No aim or knowledge base yet — open the Context tab to configure it →
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Content — fills the remaining height. The builder stays mounted (autosave
          continuity) but hidden when another tab is active. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={tab === "builder" ? "h-full" : "hidden"}>
          <BuilderTab
            campaignId={campaignId}
            running={isActive}
            accounts={accounts}
            onChanged={() => void checkGate()}
          />
        </div>
        {tab === "leads" ? (
          <div className="h-full overflow-auto px-6 py-5">
            <LeadsTab campaignId={campaignId} campaignName={campaign?.name ?? ""} onChanged={() => void load()} />
          </div>
        ) : null}
        {tab === "context" ? (
          <div className="h-full overflow-auto px-6 py-5">
            <ContextTab campaignId={campaignId} onChanged={() => void checkGate()} />
          </div>
        ) : null}
        {tab === "analytics" ? (
          <div className="h-full overflow-auto px-6 py-5">
            <AnalyticsTab campaignId={campaignId} />
          </div>
        ) : null}
        {tab === "settings" ? (
          <div className="h-full overflow-auto px-6 py-5">
            <SettingsTab campaignId={campaignId} onChanged={load} />
          </div>
        ) : null}
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
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
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

      <Modal
        open={pauseConfirmOpen}
        onClose={() => setPauseConfirmOpen(false)}
        title="Pause this campaign?"
        description="Pausing freezes every queued sequence step — leads stay parked where they are, and Resume picks each one up from that exact step."
      >
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={pauseAiToo}
              onChange={(e) => setPauseAiToo(e.target.checked)}
            />
            <span>
              Also pause AI conversation replies
              <span className="block text-xs text-muted-foreground">
                By default the AI keeps answering leads who reply while the campaign is paused.
                Check this to go fully silent — held replies send after you Resume. Replies you
                approve yourself always send.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPauseConfirmOpen(false)} disabled={busy}>
              Keep running
            </Button>
            <Button onClick={() => void pause(pauseAiToo)} disabled={busy}>
              {busy ? "Pausing…" : "Pause campaign"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        title="Stop this campaign?"
        description="Stopping cancels every queued action and ends outreach. Leads keep their progress, but re-running only picks up leads that never started. To pause and continue later, use Pause instead."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setStopConfirmOpen(false)} disabled={busy}>
            Keep running
          </Button>
          <Button variant="destructive" onClick={() => void stop()} disabled={busy}>
            {busy ? "Stopping…" : "Stop campaign"}
          </Button>
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
    </div>
  );
}
