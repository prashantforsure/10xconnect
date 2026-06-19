"use client";

import { Plus, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

const EVENTS = ["reply", "accepted_invite", "status_change"] as const;
type Event = (typeof EVENTS)[number];

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function WebhooksClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Event[]>(["reply"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      setHooks(await api.request<WebhookRow[]>("/webhooks"));
    } catch (err) {
      setError(errorMessage(err, "Could not load webhooks"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (): Promise<void> => {
    if (!url.trim() || events.length === 0) {
      return;
    }
    setError(null);
    try {
      await api.request("/webhooks", { method: "POST", body: { url: url.trim(), events } });
      setUrl("");
      setEvents(["reply"]);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not add webhook"));
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await api.request(`/webhooks/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not remove"));
    }
  };

  const toggle = (e: Event): void =>
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="surface-card p-6">
        <h2 className="font-display text-base font-semibold">Add endpoint</h2>
        <div className="mt-3 space-y-3">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.com/webhooks/10xconnect" />
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((e) => {
              const on = events.includes(e);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggle(e)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                    on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {e.replace("_", " ")}
                </button>
              );
            })}
          </div>
          <Button onClick={() => void add()} disabled={!url.trim() || events.length === 0}>
            <Plus />
            Add webhook
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : hooks.length === 0 ? (
        <div className="surface-card border-dashed p-8 text-center text-sm text-muted-foreground">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Webhook className="size-6" />
          </span>
          No webhooks configured.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
          {hooks.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm">{h.url}</div>
                <div className="text-xs text-muted-foreground">{h.events.join(", ")}</div>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void remove(h.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
