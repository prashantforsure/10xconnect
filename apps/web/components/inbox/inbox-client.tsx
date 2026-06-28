"use client";

import { Check, Inbox, Linkedin, MessageSquare, Pencil, RefreshCw, Send, Sparkles, X } from "lucide-react";
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
}
interface Message {
  id: string;
  direction: string;
  channel: string;
  body: string | null;
  voiceRef: string | null;
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
interface WorkspaceView {
  id: string;
  settings: { inbox_type: string };
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
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

  const loadList = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      const [list, sr, workspaces] = await Promise.all([
        api.request<ListItem[]>(`/conversations${filter !== "all" ? `?filter=${filter}` : ""}`),
        api.request<SavedResponse[]>("/saved-responses"),
        api.request<WorkspaceView[]>("/workspaces"),
      ]);
      setItems(list);
      setSaved(sr);
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
    <div className="flex h-full">
      {/* List */}
      <div className="flex w-80 shrink-0 flex-col border-r bg-card">
        <div className="border-b px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-display text-lg font-bold tracking-tight">Inbox</h1>
            <Button variant="outline" size="sm" onClick={() => void syncConversations()} disabled={syncing}>
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Replies auto-stop the sequence and land here.</p>
          {syncMsg ? <p className="mt-1 text-xs text-primary">{syncMsg}</p> : null}
        </div>
        <div className="flex gap-1 border-b px-3 py-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="no-scrollbar flex-1 overflow-auto">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
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
                  "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent",
                  selectedId === c.id && "bg-primary/5",
                )}
              >
                <Avatar name={c.leadName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.leadName}</span>
                    <StageBadge stage={c.pipelineStage} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.lastMessage?.direction === "outbound" ? "You: " : ""}
                    {c.lastMessage?.body ?? "—"}
                  </p>
                  {c.needsAttention || c.isImportant || c.assignedToMe ? (
                    <div className="mt-1 flex flex-wrap gap-1">
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
      <div className="flex flex-1 flex-col bg-background">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-2 size-8 text-muted-foreground/50" />
              Select a conversation
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b bg-card px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={detail.lead.name} size="md" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{detail.lead.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[detail.lead.role, detail.lead.company].filter(Boolean).join(" · ") ||
                      detail.lead.headline}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {detail.lead.linkedinUrl ? (
                  <a
                    href={detail.lead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0A66C2] hover:underline"
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

            <div className="flex-1 space-y-3 overflow-auto p-5">
              {detail.messages.length > 0 ? (
                <div className="text-center text-xs text-muted-foreground/70">
                  Conversation started {new Date(detail.messages[0].at).toLocaleDateString()}
                </div>
              ) : null}
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-soft",
                      m.direction === "outbound"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md border bg-card",
                    )}
                  >
                    {m.voiceRef ? <span className="italic">🎤 Voice note</span> : m.body}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t bg-card p-4">
              {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
              {queuedNote ? <p className="mb-2 text-xs text-primary">{queuedNote}</p> : null}

              {/* AI suggested reply (approve_all) */}
              {detail.draft?.status === "pending" && detail.draft.body && editingDraftId !== detail.draft.id ? (
                <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles className="size-3.5" /> Suggested reply
                    {typeof detail.draft.confidence === "number" ? (
                      <span className="ml-auto font-normal text-muted-foreground">
                        {Math.round(detail.draft.confidence * 100)}% confidence
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{detail.draft.body}</p>
                  <div className="mt-2.5 flex items-center gap-2">
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

              {/* Hot lead — handoff briefing (Phase 4) */}
              {detail.draft?.status === "escalated" && detail.draft.reason === "hot_lead" ? (
                <div className="mb-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs dark:border-rose-800 dark:bg-rose-950/40">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-400">
                    🔥 Hot lead — over to you
                    {detail.relationship ? (
                      <span className="ml-auto font-normal text-muted-foreground">
                        intent {detail.relationship.intentScore}
                      </span>
                    ) : null}
                  </div>
                  {detail.draft.summary ? (
                    <p className="whitespace-pre-wrap text-muted-foreground">{detail.draft.summary}</p>
                  ) : (
                    <p className="text-muted-foreground">{escalationReason(detail.draft.reason)}</p>
                  )}
                  {detail.draft.nextStep ? (
                    <p className="mt-2 font-medium text-rose-700 dark:text-rose-400">
                      Suggested next step: <span className="font-normal">{detail.draft.nextStep}</span>
                    </p>
                  ) : null}
                  <p className="mt-2 text-muted-foreground">The AI is paused on this thread — your reply goes out as you.</p>
                </div>
              ) : detail.draft?.status === "escalated" ? (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/40">
                  <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
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
                      className="rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                  placeholder="Write a reply…"
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

      <Modal
        open={inboxTypeModal}
        onClose={() => setInboxTypeModal(false)}
        title="Choose your inbox"
        description="How should we populate your inbox?"
      >
        <div className="space-y-2.5">
          <button
            onClick={() => void setInboxType("all_conversations")}
            className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-soft transition-shadow hover:shadow-soft-md"
          >
            <div className="text-sm font-medium">Extract all conversations</div>
            <div className="text-xs text-muted-foreground">
              Show every LinkedIn conversation on the account.
            </div>
          </button>
          <button
            onClick={() => void setInboxType("campaign_only")}
            className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-soft transition-shadow hover:shadow-soft-md"
          >
            <div className="text-sm font-medium">Only campaign conversations</div>
            <div className="text-xs text-muted-foreground">
              Show only replies from people in your campaigns.
            </div>
          </button>
        </div>
      </Modal>
    </div>
  );
}
