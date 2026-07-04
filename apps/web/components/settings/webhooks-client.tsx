"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FlaskConical,
  Plus,
  Power,
  Trash2,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

const EVENTS = [
  "reply",
  "accepted_invite",
  "status_change",
  "hot_lead",
  "campaign_completed",
  "message_sent",
] as const;
type Event = (typeof EVENTS)[number];

const EVENT_LABELS: Record<Event, string> = {
  reply: "New reply",
  accepted_invite: "Invite accepted",
  status_change: "Account status change",
  hot_lead: "Hot lead",
  campaign_completed: "Campaign completed",
  message_sent: "Message sent",
};

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: "active" | "disabled";
  authHeaderName: string | null;
  consecutiveFailures: number;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  eventType: string;
  attempt: number;
  status: "pending" | "delivered" | "failed";
  responseCode: number | null;
  error: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

function deliveryTone(status: DeliveryRow["status"]): string {
  if (status === "delivered") return "text-emerald-600";
  if (status === "failed") return "text-destructive";
  return "text-amber-600";
}

export function WebhooksClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Event[]>(["reply"]);
  const [authName, setAuthName] = useState("");
  const [authValue, setAuthValue] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, DeliveryRow[]>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
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
    if (!url.trim() || events.length === 0 || adding) {
      return;
    }
    setError(null);
    setAdding(true);
    try {
      const created = await api.request<WebhookRow & { secret: string }>("/webhooks", {
        method: "POST",
        body: {
          ...(name.trim() ? { name: name.trim() } : {}),
          url: url.trim(),
          events,
          ...(authName.trim() && authValue.trim()
            ? { authHeaderName: authName.trim(), authHeaderValue: authValue.trim() }
            : {}),
        },
      });
      setNewSecret(created.secret);
      setName("");
      setUrl("");
      setEvents(["reply"]);
      setAuthName("");
      setAuthValue("");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not add webhook"));
    } finally {
      setAdding(false);
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

  const setStatus = async (id: string, status: "active" | "disabled"): Promise<void> => {
    try {
      await api.request(`/webhooks/${id}`, { method: "PATCH", body: { status } });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not update webhook"));
    }
  };

  const sendTest = async (id: string): Promise<void> => {
    setTestResult((prev) => ({ ...prev, [id]: "Sending…" }));
    try {
      const res = await api.request<{ ok: boolean; status: number | null; error: string | null }>(
        `/webhooks/${id}/test`,
        { method: "POST" },
      );
      setTestResult((prev) => ({
        ...prev,
        [id]: res.ok ? `Delivered (HTTP ${res.status})` : `Failed: ${res.error ?? res.status}`,
      }));
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: errorMessage(err, "Test failed") }));
    }
  };

  const toggleLog = async (id: string): Promise<void> => {
    if (openLog === id) {
      setOpenLog(null);
      return;
    }
    setOpenLog(id);
    try {
      const rows = await api.request<DeliveryRow[]>(`/webhooks/${id}/deliveries`);
      setLogs((prev) => ({ ...prev, [id]: rows }));
    } catch {
      setLogs((prev) => ({ ...prev, [id]: [] }));
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
        <p className="mt-1 text-xs text-muted-foreground">
          We POST a signed JSON payload on every subscribed event, with automatic retries for ~24
          hours. Works with Zapier (&quot;Webhooks by Zapier&quot;), n8n, Make, or your own server.
        </p>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. CRM sync)"
              maxLength={80}
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/10xconnect"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((e) => {
              const on = events.includes(e);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggle(e)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {EVENT_LABELS[e]}
                </button>
              );
            })}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Custom auth header (optional)
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-[200px_1fr]">
              <div className="space-y-1">
                <Label className="text-xs">Header name</Label>
                <Input
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="Authorization"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Header value (stored encrypted)</Label>
                <Input
                  value={authValue}
                  onChange={(e) => setAuthValue(e.target.value)}
                  placeholder="Bearer my-token"
                />
              </div>
            </div>
          </details>
          <Button
            onClick={() => void add()}
            disabled={!url.trim() || events.length === 0 || adding}
          >
            <Plus />
            {adding ? "Adding…" : "Add webhook"}
          </Button>
        </div>
      </div>

      {newSecret ? (
        <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-medium text-success">
            Signing secret — copy it now, it won&apos;t be shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-card px-2 py-1 text-xs">{newSecret}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(newSecret)}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Verify deliveries with the <code>X-10xC-Signature</code> header:{" "}
            <code>v1 = HMAC-SHA256(secret, `$&#123;t&#125;.$&#123;body&#125;`)</code>.
          </p>
        </div>
      ) : null}

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
            <div key={h.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{h.name}</span>
                    <Badge variant={h.status === "active" ? "secondary" : "destructive"}>
                      {h.status === "active" ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{h.url}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.events.map((e) => EVENT_LABELS[e as Event] ?? e).join(", ")}
                  </div>
                  {testResult[h.id] ? (
                    <div className="mt-1 text-xs text-muted-foreground">{testResult[h.id]}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Send test event"
                    onClick={() => void sendTest(h.id)}
                  >
                    <FlaskConical className="size-4" />
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={h.status === "active" ? `Disable ${h.name}` : `Re-enable ${h.name}`}
                    title={h.status === "active" ? "Disable" : "Re-enable"}
                    onClick={() => void setStatus(h.id, h.status === "active" ? "disabled" : "active")}
                  >
                    {h.status === "active" ? <Power className="size-4" /> : <Check className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={openLog === h.id}
                    aria-label={`Delivery log for ${h.name}`}
                    onClick={() => void toggleLog(h.id)}
                  >
                    {openLog === h.id ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                    Log
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${h.name}`}
                    title="Delete"
                    className="text-destructive"
                    onClick={() => void remove(h.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              {openLog === h.id ? (
                <div className="mt-3 overflow-hidden rounded-lg border">
                  {(logs[h.id] ?? []).length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">No deliveries yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="px-3 py-1.5 font-medium">Event</th>
                          <th className="px-3 py-1.5 font-medium">Status</th>
                          <th className="px-3 py-1.5 font-medium">Attempt</th>
                          <th className="px-3 py-1.5 font-medium">Response</th>
                          <th className="px-3 py-1.5 font-medium">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(logs[h.id] ?? []).map((d) => (
                          <tr key={d.id} className="border-b last:border-0">
                            <td className="px-3 py-1.5">{EVENT_LABELS[d.eventType as Event] ?? d.eventType}</td>
                            <td className={cn("px-3 py-1.5 font-medium", deliveryTone(d.status))}>
                              {d.status}
                            </td>
                            <td className="px-3 py-1.5 tabular-nums">{d.attempt}</td>
                            <td className="px-3 py-1.5">
                              {d.responseCode ?? (d.error ? d.error.slice(0, 60) : "—")}
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {new Date(d.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
