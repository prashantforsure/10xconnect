"use client";

import { ArrowUpRight, Check, Copy, FlaskConical, X } from "lucide-react";
import Link from "next/link";
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

interface Provider {
  id: string;
  name: string;
  category: string;
  kind: "connection" | "automation" | "soon";
  connected: boolean;
  events: string[];
  status: string | null;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const MCP_URL = `${API_BASE}/mcp`;

// Production insists on a genuine hooks.slack.com URL; dev/self-host/e2e accept
// any http(s) URL so a local sink or Slack-compatible endpoint can be tested.
// Mirrors the API-side relaxation in integrations.module.ts.
const ALLOW_ANY_SLACK_URL = process.env.NODE_ENV !== "production";

function isValidSlackUrl(raw: string): boolean {
  const url = raw.trim();
  if (ALLOW_ANY_SLACK_URL) {
    return /^https?:\/\/.+/.test(url);
  }
  return url.startsWith("https://hooks.slack.com/");
}

export function IntegrationsClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [slackOpen, setSlackOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [slackUrl, setSlackUrl] = useState("");
  const [slackEvents, setSlackEvents] = useState<Event[]>(["reply", "hot_lead", "status_change"]);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      setProviders(await api.request<Provider[]>("/integrations"));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load integrations"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const connectSlack = async (): Promise<void> => {
    setMsg(null);
    try {
      const res = await api.request<{ connected: boolean; welcomeDelivered: boolean }>(
        "/integrations/slack",
        { method: "POST", body: { webhookUrl: slackUrl.trim(), events: slackEvents } },
      );
      setMsg(
        res.welcomeDelivered
          ? "Slack connected — check the channel for the welcome message."
          : "Slack saved, but the welcome message failed — double-check the webhook URL.",
      );
      setSlackOpen(false);
      setSlackUrl("");
      await load();
    } catch (err) {
      setMsg(errorMessage(err, "Could not connect Slack"));
    }
  };

  const testSlack = async (): Promise<void> => {
    setMsg("Sending test…");
    try {
      const res = await api.request<{ ok: boolean; error: string | null }>(
        "/integrations/slack/test",
        { method: "POST" },
      );
      setMsg(res.ok ? "Test message delivered to Slack." : `Test failed: ${res.error ?? "error"}`);
    } catch (err) {
      setMsg(errorMessage(err, "Test failed"));
    }
  };

  const disconnectSlack = async (): Promise<void> => {
    try {
      await api.request("/integrations/slack", { method: "DELETE" });
      setMsg("Slack disconnected.");
      await load();
    } catch (err) {
      setMsg(errorMessage(err, "Could not disconnect"));
    }
  };

  const toggleEvent = (e: Event): void =>
    setSlackEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "10xconnect": {
          url: MCP_URL,
          headers: { Authorization: "Bearer 10xc_YOUR_API_KEY" },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-4">
      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {loadError}
        </div>
      ) : null}
      {msg ? (
        <div
          role="status"
          className="rounded-xl border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground"
        >
          {msg}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.id} className="surface-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary font-display text-sm font-bold">
                  {p.name.charAt(0)}
                </span>
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.category}</div>
                </div>
              </div>
              {/* Card action by kind */}
              {p.id === "slack" ? (
                p.connected ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setSlackOpen((v) => !v)}>
                    Connect
                  </Button>
                )
              ) : p.id === "mcp" ? (
                <Button variant="outline" size="sm" onClick={() => setMcpOpen((v) => !v)}>
                  Set up
                </Button>
              ) : p.kind === "automation" ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/developers" target="_blank">
                    Guide
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </Button>
              ) : (
                <Badge variant="secondary">Coming soon</Badge>
              )}
            </div>

            {/* Slack: connected controls / connect form */}
            {p.id === "slack" && p.connected ? (
              <div className="mt-3 space-y-2 border-t pt-3">
                <div className="text-xs text-muted-foreground">
                  Posting: {p.events.map((e) => EVENT_LABELS[e as Event] ?? e).join(", ")}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void testSlack()}>
                    <FlaskConical className="size-3.5" />
                    Test
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSlackOpen((v) => !v)}>
                    Reconfigure
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void disconnectSlack()}
                  >
                    <X className="size-3.5" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : null}
            {p.id === "slack" && slackOpen ? (
              <div className="mt-3 space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="slack-url">Slack incoming-webhook URL</Label>
                  <Input
                    id="slack-url"
                    value={slackUrl}
                    onChange={(e) => setSlackUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/T…/B…/…"
                  />
                  <p className="text-xs text-muted-foreground">
                    In Slack: Apps → Incoming Webhooks → Add to Slack → pick a channel → copy the
                    URL. Stored encrypted.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {EVENTS.map((e) => {
                    const on = slackEvents.includes(e);
                    return (
                      <button
                        key={e}
                        type="button"
                        onClick={() => toggleEvent(e)}
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
                <Button
                  size="sm"
                  onClick={() => void connectSlack()}
                  disabled={!isValidSlackUrl(slackUrl) || slackEvents.length === 0}
                >
                  <Check className="size-3.5" />
                  {p.connected ? "Save" : "Connect Slack"}
                </Button>
              </div>
            ) : null}

            {/* MCP: copy-paste client config */}
            {p.id === "mcp" && mcpOpen ? (
              <div className="mt-3 space-y-3 border-t pt-3 text-xs">
                <p className="text-muted-foreground">
                  Manage campaigns, leads, and your inbox from Claude, Cursor, or any MCP client.
                  Create an API key in{" "}
                  <Link href="/settings/api" className="text-primary underline">
                    Settings → API
                  </Link>
                  , then:
                </p>
                <div>
                  <div className="mb-1 font-medium">Claude Code</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-card px-2 py-1.5">
                      claude mcp add --transport http 10xconnect {MCP_URL} --header
                      &quot;Authorization: Bearer 10xc_YOUR_API_KEY&quot;
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copy Claude Code command"
                      title="Copy"
                      className="size-7 shrink-0"
                      onClick={() =>
                        void navigator.clipboard?.writeText(
                          `claude mcp add --transport http 10xconnect ${MCP_URL} --header "Authorization: Bearer 10xc_YOUR_API_KEY"`,
                        )
                      }
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="mb-1 font-medium">Cursor / other clients (mcp.json)</div>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-lg bg-card p-2">{mcpConfig}</pre>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copy mcp.json config"
                      title="Copy"
                      className="absolute right-1.5 top-1.5 size-7"
                      onClick={() => void navigator.clipboard?.writeText(mcpConfig)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  Full guide on the{" "}
                  <Link href="/developers" target="_blank" className="text-primary underline">
                    developers page
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Zapier, n8n, Make, and Clay work today through your{" "}
        <Link href="/settings/api" className="text-primary underline">
          API key
        </Link>{" "}
        and{" "}
        <Link href="/settings/webhooks" className="text-primary underline">
          webhooks
        </Link>{" "}
        — see the{" "}
        <Link href="/developers" target="_blank" className="text-primary underline">
          developer guide
        </Link>{" "}
        for step-by-step recipes.
      </p>
    </div>
  );
}
