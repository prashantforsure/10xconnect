"use client";

import { Inbox, Linkedin, MessageSquare, RefreshCw, Send } from "lucide-react";
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

interface ListItem {
  id: string;
  leadName: string;
  channel: string;
  pipelineStage: Stage;
  tags: string[];
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
interface Detail {
  id: string;
  pipelineStage: Stage;
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

export function InboxClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [items, setItems] = useState<ListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [saved, setSaved] = useState<SavedResponse[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        api.request<ListItem[]>("/conversations"),
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
  }, [api, activeWorkspaceId, selectedId]);

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
    try {
      await api.request(`/conversations/${selectedId}/reply`, { method: "POST", body: { body: reply.trim() } });
      setReply("");
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(errorMessage(err, "Could not send reply"));
    } finally {
      setSending(false);
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
              <div className="flex items-center gap-3">
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
