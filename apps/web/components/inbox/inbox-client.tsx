"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Inbox,
  Linkedin,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

type Stage = "new" | "in_conversation" | "qualified" | "booked" | "lost";
const STAGES: Stage[] = ["new", "in_conversation", "qualified", "booked", "lost"];
const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  in_conversation: "In conversation",
  qualified: "Qualified",
  booked: "Booked",
  lost: "Lost",
};
const STAGE_VARIANT: Record<Stage, NonNullable<BadgeProps["variant"]>> = {
  new: "muted",
  in_conversation: "default",
  qualified: "warning",
  booked: "success",
  lost: "destructive",
};

function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge variant={STAGE_VARIANT[stage] ?? "muted"} className="shrink-0">
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

type Filter = "all" | "reply_required" | "important" | "mine";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "reply_required", label: "Reply required" },
  { key: "important", label: "Important" },
  { key: "mine", label: "Mine" },
];

interface ListItem {
  id: string;
  leadName: string;
  channel: string;
  pipelineStage: Stage;
  tags: string[];
  needsAttention: boolean;
  isImportant: boolean;
  assignedToMe: boolean;
  updatedAt: string;
  lastMessage: { body: string | null; direction: string; at: string } | null;
  /** The connected LinkedIn profile this conversation belongs to (unibox attribution). */
  account: { id: string; name: string | null; avatarUrl: string | null } | null;
}
interface Message {
  id: string;
  direction: string;
  channel: string;
  body: string | null;
  voiceRef: string | null;
  authoredBy?: "human" | "ai";
  at: string;
}
interface DraftView {
  id: string;
  status: "pending" | "escalated";
  body: string | null;
  confidence: number | null;
  reason: string | null;
  action: string | null;
  summary: string | null;
  nextStep: string | null;
}
interface RelationshipView {
  stage: string;
  intentScore: number;
  summary: string | null;
  nextAction: string | null;
  aiPaused: boolean;
  isHot: boolean;
  aiMode?: string | null;
  hasBrain?: boolean;
}
interface Detail {
  id: string;
  pipelineStage: Stage;
  needsAttention: boolean;
  isImportant: boolean;
  assignedToMe: boolean;
  draft: DraftView | null;
  relationship: RelationshipView | null;
  lead: {
    name: string;
    headline: string | null;
    company: string | null;
    role: string | null;
    linkedinUrl: string | null;
    email: string | null;
    tags: string[];
  };
  messages: Message[];
}
interface SavedResponse {
  id: string;
  title: string;
  body: string;
}
interface AiSdrStats {
  aiReplies: number;
  conversationsHandled: number;
  hotLeads: number;
  escalations: number;
  pendingDrafts: number;
  estimatedHoursSaved: number;
}
interface SimLead {
  id: string;
  name: string | null;
  linkedinUrl: string | null;
}

/** Dev-only simulate helper: exposed only outside production (mock adapter). */
const IS_DEV = process.env.NODE_ENV !== "production";
/** One-click reply scenarios that exercise each AI SDR path. */
const SIM_SCENARIOS: { label: string; body: string }[] = [
  { label: "Curious", body: "Sounds interesting — how does onboarding work?" },
  { label: "Pricing (hot lead)", body: "This looks great. How much does the Pro plan cost? Ready to move fast." },
  { label: "Not interested", body: "Thanks but we're not interested. Please remove me." },
  { label: "Are you a bot?", body: "Quick question — am I talking to a real person or an AI?" },
];
interface WorkspaceView {
  id: string;
  settings: { inbox_type: string };
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

/** Plain-English label for a campaign's AI reply mode (autonomy dial). */
function aiModeLabel(mode: string | null | undefined): string | null {
  switch (mode) {
    case "full_auto":
      return "Autopilot — auto-replying";
    case "auto_easy_escalate_hard":
      return "Auto-replying · escalates hard ones";
    case "approve_all":
      return "Drafts for your approval";
    default:
      return null;
  }
}

function escalationReason(reason: string | null): string {
  switch (reason) {
    case "out_of_knowledge":
      return "Outside the knowledge base — please answer this one yourself (the AI won't invent facts).";
    case "hard_no":
    case "not_interested":
      return "They sound like a no — worth a personal reply. They've been added to your do-not-contact list.";
    case "unsubscribe":
      return "They asked to opt out — added to your do-not-contact list. A short personal acknowledgement is fine.";
    case "max_turns":
      return "The AI hit its reply limit for this conversation — time for a human to take over.";
    case "loop":
      return "Looks like an auto-responder loop — paused the AI here so it doesn't ping-pong.";
    case "budget_exceeded":
      return "This campaign hit its daily AI budget — replies are paused until tomorrow (or raise the cap).";
    case "no_model":
    case "generation_failed":
      return "The AI couldn't draft a reply — please respond manually.";
    default:
      return "This one needs your attention — please reply manually.";
  }
}

/** Centered day header between message groups (e.g. "June 18, 2026"). */
function formatDayDivider(at: string): string {
  return new Date(at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
/** Compact message time (e.g. "1:59 PM"). */
function formatMsgTime(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * A boolean that remembers itself in localStorage, so a user's choice to collapse
 * a space-heavy panel (the AI SDR activity strip, the per-thread relationship card)
 * sticks across reloads instead of resetting every visit. Falls back to the in-memory
 * default when storage is unavailable (SSR / privacy mode). We read storage in an
 * effect (not during render) to avoid a hydration mismatch.
 */
function usePersistentBool(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        setValue(stored === "1");
      }
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [key]);
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}

export function InboxClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [items, setItems] = useState<ListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [saved, setSaved] = useState<SavedResponse[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [inboxTypeModal, setInboxTypeModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [aiSdr, setAiSdr] = useState<{ enabled: boolean } | null>(null);
  const [aiStats, setAiStats] = useState<AiSdrStats | null>(null);
  // Collapse/dismiss for the space-heavy info panels. Collapse state persists
  // (a preference); dismissals are per-conversation for this session (a reminder
  // that should come back next time the thread is opened fresh).
  const [cockpitOpen, setCockpitOpen] = usePersistentBool("inbox.cockpitOpen", false);
  const [relOpen, setRelOpen] = usePersistentBool("inbox.relOpen", false);
  const [dismissedRel, setDismissedRel] = useState<Set<string>>(() => new Set());
  const [dismissedHot, setDismissedHot] = useState<Set<string>>(() => new Set());
  // Dev-only: simulate an inbound lead reply (mock adapter) to exercise the AI SDR.
  const [simOpen, setSimOpen] = useState(false);
  const [simLeads, setSimLeads] = useState<SimLead[]>([]);
  const [simLeadId, setSimLeadId] = useState<string>("");
  const [simBody, setSimBody] = useState<string>(SIM_SCENARIOS[0].body);
  const [simBusy, setSimBusy] = useState(false);
  const [simNote, setSimNote] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      const [list, sr, workspaces, sdr, stats] = await Promise.all([
        api.request<ListItem[]>(`/conversations${filter !== "all" ? `?filter=${filter}` : ""}`),
        api.request<SavedResponse[]>("/saved-responses"),
        api.request<WorkspaceView[]>("/workspaces"),
        api.request<{ enabled: boolean }>("/ai-sdr/settings").catch(() => null),
        api.request<AiSdrStats>("/analytics/ai-sdr?range=30d").catch(() => null),
      ]);
      setItems(list);
      setSaved(sr);
      setAiSdr(sdr);
      setAiStats(stats);
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (ws && ws.settings.inbox_type === "not_configured") {
        setInboxTypeModal(true);
      }
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      setError(errorMessage(err, "Could not load inbox"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId, selectedId, filter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        setDetail(await api.request<Detail>(`/conversations/${id}`));
      } catch (err) {
        setError(errorMessage(err, "Could not load conversation"));
      }
    },
    [api],
  );

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [selectedId, loadDetail]);

  const syncConversations = useCallback(async (): Promise<void> => {
    if (!activeWorkspaceId) {
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const r = await api.request<{
        supported: boolean;
        accountConnected: boolean;
        conversationsAdded: number;
        messagesAdded: number;
        newContacts: number;
      }>("/conversations/sync", { method: "POST" });
      if (!r.supported) {
        setSyncMsg("Conversation sync isn't available for this transport.");
      } else if (!r.accountConnected) {
        setSyncMsg("Connect a LinkedIn account (Settings → Accounts) to sync conversations.");
      } else if (r.conversationsAdded === 0) {
        setSyncMsg("You're up to date — no new conversations found.");
      } else {
        setSyncMsg(`Synced ${r.conversationsAdded} conversation${r.conversationsAdded === 1 ? "" : "s"}.`);
      }
      await loadList();
    } catch (err) {
      setError(errorMessage(err, "Could not sync conversations"));
    } finally {
      setSyncing(false);
    }
  }, [api, activeWorkspaceId, loadList]);

  const send = async (): Promise<void> => {
    if (!selectedId || !reply.trim()) {
      return;
    }
    setSending(true);
    setError(null);
    const id = selectedId;
    try {
      // The reply is enqueued, not sent inline — the worker dispatches it through
      // the safety spine. If we're editing an AI draft, approve it with the edit
      // so the same draft is marked approved + reflected.
      if (editingDraftId) {
        await api.request(`/conversations/${id}/draft/approve`, { method: "POST", body: { editedBody: reply.trim() } });
        setEditingDraftId(null);
      } else {
        await api.request(`/conversations/${id}/reply`, { method: "POST", body: { body: reply.trim() } });
      }
      setReply("");
      setQueuedNote("Queued · sending…");
      window.setTimeout(() => {
        void loadDetail(id);
        void loadList();
      }, 1500);
      window.setTimeout(() => {
        void loadDetail(id);
        void loadList();
        setQueuedNote(null);
      }, 4000);
    } catch (err) {
      setError(errorMessage(err, "Could not send reply"));
    } finally {
      setSending(false);
    }
  };

  const approveDraft = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    setSending(true);
    setError(null);
    const id = selectedId;
    try {
      await api.request(`/conversations/${id}/draft/approve`, { method: "POST", body: {} });
      setQueuedNote("Approved · sending…");
      window.setTimeout(() => {
        void loadDetail(id);
        void loadList();
      }, 1500);
      window.setTimeout(() => {
        void loadDetail(id);
        void loadList();
        setQueuedNote(null);
      }, 4000);
    } catch (err) {
      setError(errorMessage(err, "Could not approve the draft"));
    } finally {
      setSending(false);
    }
  };

  const discardDraft = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    try {
      await api.request(`/conversations/${selectedId}/draft/discard`, { method: "POST", body: {} });
      setEditingDraftId(null);
      await loadDetail(selectedId);
    } catch (err) {
      setError(errorMessage(err, "Could not discard the draft"));
    }
  };

  const editDraft = (body: string): void => {
    if (!detail?.draft) {
      return;
    }
    setReply(body);
    setEditingDraftId(detail.draft.id);
  };

  const toggleImportant = async (): Promise<void> => {
    if (!selectedId || !detail) {
      return;
    }
    try {
      await api.request(`/conversations/${selectedId}`, {
        method: "PATCH",
        body: { isImportant: !detail.isImportant },
      });
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(errorMessage(err, "Could not update conversation"));
    }
  };

  const toggleAssignment = async (): Promise<void> => {
    if (!selectedId || !detail) {
      return;
    }
    try {
      await api.request(`/conversations/${selectedId}`, {
        method: "PATCH",
        body: detail.assignedToMe ? { assignedTo: null } : { assignToMe: true },
      });
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(errorMessage(err, "Could not update assignment"));
    }
  };

  const setStage = async (stage: Stage): Promise<void> => {
    if (!selectedId) {
      return;
    }
    try {
      await api.request(`/conversations/${selectedId}`, { method: "PATCH", body: { pipelineStage: stage } });
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(errorMessage(err, "Could not update stage"));
    }
  };

  // Workspace AI SDR master switch — the safety valve. Optimistic; reverts on error.
  const toggleMasterSwitch = async (): Promise<void> => {
    if (!aiSdr) {
      return;
    }
    const next = !aiSdr.enabled;
    setAiSdr({ enabled: next });
    try {
      await api.request("/ai-sdr/settings", { method: "PUT", body: { enabled: next } });
    } catch (err) {
      setAiSdr({ enabled: !next });
      setError(errorMessage(err, "Could not update the AI SDR switch"));
    }
  };

  // Per-thread AI control: pause (human takes over) / resume (hand back to the AI).
  const toggleThreadAi = async (): Promise<void> => {
    if (!selectedId || !detail?.relationship) {
      return;
    }
    const paused = detail.relationship.aiPaused;
    try {
      await api.request(`/conversations/${selectedId}/ai/${paused ? "resume" : "pause"}`, { method: "POST", body: {} });
      await loadDetail(selectedId);
    } catch (err) {
      setError(errorMessage(err, "Could not update AI control"));
    }
  };

  // Dev-only: open the "simulate a reply" dialog and load leads to pick from.
  const openSimulate = async (): Promise<void> => {
    setSimNote(null);
    setSimOpen(true);
    try {
      const res = await api.request<{ leads: SimLead[] }>("/leads?limit=50");
      setSimLeads(res.leads ?? []);
      setSimLeadId((cur) => cur || res.leads?.[0]?.id || "");
    } catch (err) {
      setSimNote(errorMessage(err, "Could not load leads"));
    }
  };

  // Inject a mock inbound reply, then refresh so the AI's response appears.
  const runSimulate = async (): Promise<void> => {
    if (!simLeadId || !simBody.trim()) {
      return;
    }
    setSimBusy(true);
    setSimNote(null);
    try {
      await api.request("/dev/simulate", {
        method: "POST",
        body: { type: "reply", leadId: simLeadId, body: simBody.trim() },
      });
      setSimOpen(false);
      setSyncMsg("Simulated a reply — watch the AI respond…");
      // Let the dispatch worker run the AI turn, then refresh the inbox twice.
      window.setTimeout(() => void loadList(), 1500);
      window.setTimeout(() => {
        void loadList();
        setSyncMsg(null);
      }, 5000);
    } catch (err) {
      setSimNote(errorMessage(err, "Could not simulate the reply"));
    } finally {
      setSimBusy(false);
    }
  };

  const setInboxType = async (type: string): Promise<void> => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      await api.request(`/workspaces/${activeWorkspaceId}`, {
        method: "PATCH",
        body: { settings: { inbox_type: type } },
      });
    } catch {
      // non-blocking
    }
    setInboxTypeModal(false);
    // Picking a type means "populate my inbox now" — kick off the first sync.
    void syncConversations();
  };

  if (!activeWorkspaceId) {
    return <div className="p-8 text-sm text-muted-foreground">Select a workspace.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* AI SDR cockpit: the master switch (safety valve) + live activity — the
          answer to "is this real AI, and what did it do for me?". The activity
          stats collapse away (they eat a lot of room); the master switch always
          stays visible — hiding a safety control would be wrong. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">AI SDR</span>
          <Badge variant={aiSdr?.enabled === false ? "muted" : "default"}>
            {aiSdr?.enabled === false ? "Paused" : "On"}
          </Badge>
          {aiStats ? (
            <button
              type="button"
              onClick={() => setCockpitOpen(!cockpitOpen)}
              aria-expanded={cockpitOpen}
              className="ml-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={cockpitOpen ? "Hide AI SDR activity" : "Show AI SDR activity"}
            >
              {cockpitOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {cockpitOpen ? "Hide activity" : "Activity"}
            </button>
          ) : null}
          {/* Collapsed still surfaces the one number that needs action. */}
          {aiStats && !cockpitOpen && aiStats.pendingDrafts > 0 ? (
            <span className="text-xs text-muted-foreground">
              <b className="text-foreground">{aiStats.pendingDrafts}</b> awaiting you
            </span>
          ) : null}
        </div>
        {aiStats && cockpitOpen ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <b className="text-foreground">{aiStats.aiReplies}</b> AI replies
            </span>
            <span>
              <b className="text-foreground">{aiStats.hotLeads}</b> hot leads escalated
            </span>
            <span>
              <b className="text-foreground">{aiStats.pendingDrafts}</b> awaiting you
            </span>
            <span>~{aiStats.estimatedHoursSaved}h saved</span>
            <span className="text-muted-foreground/60">last 30d</span>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void toggleMasterSwitch()}
          disabled={!aiSdr}
          title={
            aiSdr?.enabled === false
              ? "Let the AI SDR answer replies again"
              : "Stop the AI SDR from answering any replies (drafts still appear for approval)"
          }
        >
          {aiSdr?.enabled === false ? "Resume AI SDR" : "Pause AI SDR"}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* List */}
        <div className="flex w-[330px] min-h-0 shrink-0 flex-col border-r border-border bg-card">
        <div className="shrink-0 px-[18px] pb-3 pt-[18px]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="font-display text-[19px] font-semibold tracking-tight text-foreground">Inbox</h1>
            <div className="flex items-center gap-1.5">
              {IS_DEV ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openSimulate()}
                  title="Simulate an inbound lead reply (dev only, mock adapter) to watch the AI SDR respond"
                >
                  <FlaskConical className="size-4" />
                  Simulate
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void syncConversations()} disabled={syncing}>
                <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            </div>
          </div>
          <p className="mb-2.5 text-xs text-muted-foreground">Replies auto-stop the sequence and land here.</p>
          {syncMsg ? <p className="mb-2.5 text-xs text-primary">{syncMsg}</p> : null}
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="no-scrollbar flex flex-1 flex-col gap-0.5 overflow-auto px-2.5 pb-2.5">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Inbox className="size-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                No conversations yet. They appear when a lead replies.
              </p>
            </div>
          ) : (
            items.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent",
                  selectedId === c.id && "bg-accent ring-1 ring-border",
                )}
              >
                <Avatar name={c.leadName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{c.leadName}</span>
                    {c.needsAttention ? (
                      <span
                        aria-hidden="true"
                        className="size-[7px] shrink-0 rounded-full bg-primary"
                      />
                    ) : null}
                    <StageBadge stage={c.pipelineStage} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {c.lastMessage?.direction === "outbound" ? "You: " : ""}
                    {c.lastMessage?.body ?? "—"}
                  </p>
                  {c.account?.name ? (
                    <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground/70">
                      <Linkedin className="size-3 shrink-0" />
                      via {c.account.name}
                    </p>
                  ) : null}
                  {c.needsAttention || c.isImportant || c.assignedToMe ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.needsAttention ? (
                        <Badge variant="warning" className="shrink-0">
                          Reply required
                        </Badge>
                      ) : null}
                      {c.isImportant ? (
                        <Badge variant="destructive" className="shrink-0">
                          ★ Important
                        </Badge>
                      ) : null}
                      {c.assignedToMe ? (
                        <Badge variant="muted" className="shrink-0">
                          Mine
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-2 size-8 text-muted-foreground/50" />
              Select a conversation
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/60 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={detail.lead.name} size="md" />
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{detail.lead.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[detail.lead.role, detail.lead.company].filter(Boolean).join(" · ") ||
                      detail.lead.headline}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Per-thread AI kill-switch — lives in the always-visible header (never
                    behind the collapsible/dismissible relationship card) so a safety
                    control is always one click away. */}
                {detail.relationship && (detail.relationship.hasBrain || detail.relationship.aiPaused) ? (
                  <Button
                    variant={detail.relationship.aiPaused ? "default" : "outline"}
                    size="sm"
                    onClick={() => void toggleThreadAi()}
                    title={
                      detail.relationship.aiPaused
                        ? "Let the AI handle this thread again"
                        : "Pause the AI and take this thread over"
                    }
                  >
                    <Sparkles className="size-4" />
                    {detail.relationship.aiPaused ? "Resume AI" : "Pause AI"}
                  </Button>
                ) : null}
                {detail.lead.linkedinUrl ? (
                  <a
                    href={detail.lead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-chart-2 hover:underline"
                  >
                    <Linkedin className="size-4" /> Profile
                  </a>
                ) : null}
                <Button
                  variant={detail.isImportant ? "default" : "outline"}
                  size="sm"
                  onClick={() => void toggleImportant()}
                >
                  ★ Important
                </Button>
                <Button
                  variant={detail.assignedToMe ? "default" : "outline"}
                  size="sm"
                  onClick={() => void toggleAssignment()}
                >
                  {detail.assignedToMe ? "Assigned to you" : "Assign to me"}
                </Button>
                <Select
                  value={detail.pipelineStage}
                  onChange={(e) => void setStage(e.target.value as Stage)}
                  className="h-9 w-auto min-w-[10rem]"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Relationship / intent summary (account-safety first: AI-pause + hot-lead).
                Collapsed by default to a single line so it doesn't eat the thread;
                expand for the next action + AI controls, or dismiss it for this thread. */}
            {detail.relationship && !dismissedRel.has(detail.id) ? (
              <div className="shrink-0 border-b border-border/70 px-5 py-2">
                <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-background px-3 py-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-display text-[11px] font-bold text-primary">
                    {detail.relationship.intentScore}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate text-[11.5px] font-semibold leading-tight text-foreground">
                        {detail.relationship.summary ?? STAGE_LABEL[detail.pipelineStage]}
                      </span>
                      {detail.relationship.isHot ? (
                        <Badge variant="default" className="shrink-0">
                          🔥 Hot
                        </Badge>
                      ) : null}
                      {/* Keep the paused signal visible even when collapsed. */}
                      {!relOpen && detail.relationship.aiPaused ? (
                        <Badge variant="warning" className="shrink-0">
                          AI paused
                        </Badge>
                      ) : null}
                    </div>
                    {relOpen && detail.relationship.nextAction ? (
                      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        {detail.relationship.nextAction}
                      </div>
                    ) : null}
                    {/* AI SDR status (informational). The Pause/Resume control lives in
                        the thread header so it's always reachable, even when this card is
                        collapsed or dismissed. */}
                    {relOpen && (detail.relationship.hasBrain || detail.relationship.aiPaused) ? (
                      <div className="mt-2 flex items-center gap-2">
                        {detail.relationship.aiPaused ? (
                          <Badge variant="warning">AI paused</Badge>
                        ) : aiModeLabel(detail.relationship.aiMode) ? (
                          <span className="flex items-center gap-1 text-[10.5px] font-medium text-primary/80">
                            <Sparkles className="size-3" /> {aiModeLabel(detail.relationship.aiMode)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRelOpen(!relOpen)}
                    aria-expanded={relOpen}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={relOpen ? "Collapse" : "Expand"}
                  >
                    {relOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedRel((s) => new Set(s).add(detail.id))}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Dismiss for this conversation"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">
              <div className="flex w-full flex-col">
                {detail.messages.map((m, i) => {
                  const prev = detail.messages[i - 1];
                  const showDay =
                    !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
                  const outbound = m.direction === "outbound";
                  const aiSent = outbound && m.authoredBy === "ai";
                  return (
                    <div key={m.id} className="flex flex-col">
                      {showDay ? (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-full bg-muted/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                            {formatDayDivider(m.at)}
                          </span>
                        </div>
                      ) : null}
                      <div className={cn("mb-1.5 flex flex-col", outbound ? "items-end" : "items-start")}>
                        <div
                          className={cn(
                            "max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                            outbound
                              ? "rounded-br-md bg-primary text-primary-foreground"
                              : "rounded-bl-md border border-border bg-card text-foreground",
                          )}
                        >
                          {m.voiceRef ? <span className="italic">🎤 Voice note</span> : m.body}
                        </div>
                        <span
                          className={cn(
                            "mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground/70",
                            outbound && "flex-row-reverse",
                          )}
                        >
                          {formatMsgTime(m.at)}
                          {aiSent ? (
                            <span className="flex items-center gap-0.5 text-primary/80">
                              <Sparkles className="size-2.5" /> AI
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-card p-4">
              {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
              {queuedNote ? <p className="mb-2 text-xs text-primary">{queuedNote}</p> : null}

              {/* AI draft awaiting a human — shown when the autonomy dial held it
                  back (Manual mode, or a factual answer needing approval). */}
              {detail.draft?.status === "pending" && detail.draft.body && editingDraftId !== detail.draft.id ? (
                <div className="mb-3 overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.07]">
                  <div className="flex items-center gap-2 border-b border-primary/20 px-3.5 py-2.5">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="text-xs font-semibold text-primary">AI draft</span>
                    {typeof detail.draft.confidence === "number" ? (
                      <span className="ml-auto text-[10.5px] font-normal text-muted-foreground">
                        {Math.round(detail.draft.confidence * 100)}% confidence
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap px-3.5 py-3 text-sm leading-relaxed text-card-foreground">
                    {detail.draft.body}
                  </p>
                  <div className="flex items-center gap-2 px-3.5 pb-3">
                    <Button size="sm" onClick={() => void approveDraft()} disabled={sending}>
                      <Check className="size-4" /> Approve &amp; send
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => editDraft(detail.draft?.body ?? "")}>
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void discardDraft()}>
                      <X className="size-4" /> Discard
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Hot lead — handoff briefing (Phase 4). Dismissible: it's a reminder,
                  not a blocker, and it takes real estate above the reply box. */}
              {detail.draft?.status === "escalated" &&
              detail.draft.reason === "hot_lead" &&
              !dismissedHot.has(detail.draft.id) ? (
                <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/[0.08] p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-destructive">
                    🔥 Hot lead — over to you
                    {detail.relationship ? (
                      <span className="ml-auto font-normal text-muted-foreground">
                        intent {detail.relationship.intentScore}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        const id = detail.draft?.id;
                        if (id) {
                          setDismissedHot((s) => new Set(s).add(id));
                        }
                      }}
                      className={cn(
                        "rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                        detail.relationship ? "ml-1.5" : "ml-auto",
                      )}
                      title="Dismiss this reminder"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  {detail.draft.summary ? (
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">{detail.draft.summary}</p>
                  ) : (
                    <p className="text-muted-foreground">{escalationReason(detail.draft.reason)}</p>
                  )}
                  {detail.draft.nextStep ? (
                    <p className="mt-2 font-medium text-destructive">
                      Suggested next step: <span className="font-normal text-muted-foreground">{detail.draft.nextStep}</span>
                    </p>
                  ) : null}
                  <p className="mt-2 text-muted-foreground">The AI is paused on this thread — your reply goes out as you.</p>
                </div>
              ) : detail.draft?.status === "escalated" && detail.draft.reason !== "hot_lead" ? (
                <div className="mb-3 rounded-xl border border-warning/30 bg-warning/[0.08] p-3 text-xs">
                  <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-warning">
                    <Sparkles className="size-3.5" /> AI escalated to you
                  </div>
                  <p className="text-muted-foreground">{escalationReason(detail.draft.reason)}</p>
                </div>
              ) : null}

              {editingDraftId ? (
                <p className="mb-2 text-xs text-primary">Editing the AI draft — Send to approve your edit.</p>
              ) : null}

              {saved.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {saved.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setReply(s.body)}
                      className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title={s.body}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply, or use the AI draft…"
                  className="min-h-[44px]"
                />
                <Button onClick={() => void send()} disabled={!reply.trim() || sending}>
                  <Send />
                  {sending ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
          </>
        )}
        </div>
      </div>

      <Modal
        open={inboxTypeModal}
        onClose={() => setInboxTypeModal(false)}
        title="Choose your inbox"
        description="How should we populate your inbox?"
      >
        <div className="space-y-2.5">
          <button
            onClick={() => void setInboxType("all_conversations")}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-left transition-colors hover:border-input hover:bg-accent"
          >
            <div className="text-sm font-medium text-foreground">Extract all conversations</div>
            <div className="text-xs text-muted-foreground">
              Show every LinkedIn conversation on the account.
            </div>
          </button>
          <button
            onClick={() => void setInboxType("campaign_only")}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-left transition-colors hover:border-input hover:bg-accent"
          >
            <div className="text-sm font-medium text-foreground">Only campaign conversations</div>
            <div className="text-xs text-muted-foreground">
              Show only replies from people in your campaigns.
            </div>
          </button>
        </div>
      </Modal>

      <Modal
        open={simOpen}
        onClose={() => setSimOpen(false)}
        title="Simulate a lead reply"
        description="Dev only (mock adapter): inject an inbound reply and watch the AI SDR draft, auto-send, or escalate."
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reply from</label>
            <Select value={simLeadId} onChange={(e) => setSimLeadId(e.target.value)}>
              {simLeads.length === 0 ? <option value="">No leads yet — import some first</option> : null}
              {simLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.linkedinUrl || l.id}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Scenario</label>
            <div className="flex flex-wrap gap-1.5">
              {SIM_SCENARIOS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setSimBody(s.body)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    simBody === s.body
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Message</label>
            <Textarea value={simBody} onChange={(e) => setSimBody(e.target.value)} className="min-h-[70px]" />
          </div>
          <p className="text-xs text-muted-foreground">
            The AI only replies when this lead is enrolled in a running campaign that has an AI brain, and the AI
            SDR master switch is on. Otherwise the reply just lands in the inbox.
          </p>
          {simNote ? <p className="text-xs text-destructive">{simNote}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setSimOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void runSimulate()} disabled={simBusy || !simLeadId || !simBody.trim()}>
              <FlaskConical className="size-4" />
              {simBusy ? "Simulating…" : "Simulate reply"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
