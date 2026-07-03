"use client";

import {
  AlertTriangle,
  ExternalLink,
  Infinity as InfinityIcon,
  Info,
  Linkedin,
  Lock,
  MoreHorizontal,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { COUNTRIES } from "@/lib/countries";
import {
  captureLinkedInSession,
  detectExtension,
  ExtensionError,
  EXTENSION_STORE_URL,
} from "@/lib/extension/linkedin";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

type AccountStatus = "active" | "warming" | "paused" | "restricted" | "disconnected";
type ConnectionMethod = "credentials" | "extension" | "cookie" | "hosted_auth";

interface AccountView {
  id: string;
  type: "linkedin" | "mailbox";
  connection_method: ConnectionMethod | null;
  name: string | null;
  label: string | null;
  proxy_type: "bundled" | "own" | null;
  proxy_region: string | null;
  country: string | null;
  status: AccountStatus;
  health_score: number;
  avatar_url: string | null;
}

interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  account_id: string | null;
  read: boolean;
  created_at: string;
}

interface ConnectionGuidance {
  twoFactorRequired: boolean;
  summary: string;
  steps: string[];
}
interface ConnectResponse {
  account: AccountView;
  guidance: ConnectionGuidance;
}

const STATUS_VARIANT: Record<AccountStatus, NonNullable<BadgeProps["variant"]>> = {
  active: "success",
  warming: "warning",
  paused: "muted",
  restricted: "destructive",
  disconnected: "muted",
};
const STATUS_LABEL: Record<AccountStatus, string> = {
  active: "Active",
  warming: "Warming up",
  paused: "Paused",
  restricted: "Restricted",
  disconnected: "Disconnected",
};
const METHOD_LABEL: Record<ConnectionMethod, string> = {
  hosted_auth: "Hosted login",
  extension: "Extension",
  cookie: "Session cookie",
  credentials: "Infinite login",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

function StatusBadge({ status }: { status: AccountStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

// Health tone shared by the ring + pacing bar: green ≥80, amber ≥50, else coral.
function healthTone(score: number): { text: string; ring: string; track: string } {
  if (score >= 80) {
    return { text: "text-success", ring: "hsl(var(--success))", track: "bg-success" };
  }
  if (score >= 50) {
    return { text: "text-warning", ring: "hsl(var(--warning))", track: "bg-warning" };
  }
  return { text: "text-destructive", ring: "hsl(var(--destructive))", track: "bg-destructive" };
}

// Premium focal element: a circular health ring whose sweep reflects the score.
function HealthRing({ score }: { score: number }) {
  const tone = healthTone(score);
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span
      className="relative flex size-14 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${tone.ring} ${pct * 3.6}deg, hsl(var(--secondary)) 0deg)`,
      }}
      aria-hidden="true"
    >
      <span className="flex size-[46px] items-center justify-center rounded-full bg-card">
        <span className={cn("font-display text-sm font-bold tabular-nums", tone.text)}>{score}</span>
      </span>
    </span>
  );
}

// Restriction/checkpoint incidents are the high-severity (destructive) ones; an
// auto-throttle is advisory (warning). Anything else falls back to an info notice.
function noticeTone(type: string): "destructive" | "warning" {
  return type === "account_restricted" || type === "account_checkpoint" || type === "account_disconnected"
    ? "destructive"
    : "warning";
}

function IncidentNotices({
  notices,
  onDismiss,
}: {
  notices: NotificationView[];
  onDismiss: (id: string) => void | Promise<void>;
}) {
  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2" data-testid="incident-notices">
      {notices.map((n) => {
        const tone = noticeTone(n.type);
        const toneClass =
          tone === "destructive"
            ? "border-destructive/30 bg-destructive/[0.07] text-destructive"
            : "border-warning/30 bg-warning/[0.07] text-warning";
        return (
          <div
            key={n.id}
            role="alert"
            className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", toneClass)}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{n.title}</p>
              {n.body ? <p className="mt-0.5 text-muted-foreground">{n.body}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => void onDismiss(n.id)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AccountsClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [notices, setNotices] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Connect modals. `target` is the account being reconnected, or null for a
  // first-time connect (a workspace holds exactly one LinkedIn account). Hosted
  // Auth is the primary flow; the extension/li_at modal is the "another way".
  const [hostedOpen, setHostedOpen] = useState(false);
  const [hostedTarget, setHostedTarget] = useState<AccountView | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<AccountView | null>(null);
  const [guidance, setGuidance] = useState<ConnectionGuidance | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<AccountView | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setAccounts(await api.request<AccountView[]>("/accounts"));
    } catch (err) {
      setError(errorMessage(err, "Could not load accounts"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);

  // Unread incident notifications (restriction/checkpoint/auto-throttle auto-pauses
  // written by the engine). Surfaced here so an account pause is visible — not just
  // an inert status badge. Best-effort: a notifications failure never blocks the page.
  const loadNotices = useCallback(async () => {
    if (!activeWorkspaceId) {
      setNotices([]);
      return;
    }
    try {
      setNotices(await api.request<NotificationView[]>("/notifications?unread=true"));
    } catch {
      setNotices([]);
    }
  }, [api, activeWorkspaceId]);

  useEffect(() => {
    void load();
    void loadNotices();
  }, [load, loadNotices]);

  const dismissNotice = async (id: string): Promise<void> => {
    // Optimistic: drop it immediately, then persist the read.
    setNotices((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.request(`/notifications/${id}/read`, { method: "POST" });
    } catch {
      // If the persist fails, re-sync so the notice reappears rather than silently vanishing.
      void loadNotices();
    }
  };

  const linkedInAccounts = accounts.filter((a) => a.type === "linkedin");

  // Open the method chooser (equal options). `target` = the account to reconnect,
  // or null to connect a brand-new account.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserTarget, setChooserTarget] = useState<AccountView | null>(null);
  const [connectInitialMode, setConnectInitialMode] = useState<ConnectMode>("extension");
  const [infiniteOpen, setInfiniteOpen] = useState(false);
  const [infiniteTarget, setInfiniteTarget] = useState<AccountView | null>(null);

  const openConnect = (target: AccountView | null): void => {
    setChooserTarget(target);
    setChooserOpen(true);
  };
  // The chooser routes to one of the four connect flows.
  const pickMethod = (method: ConnectChoice): void => {
    setChooserOpen(false);
    if (method === "infinite") {
      setInfiniteTarget(chooserTarget);
      setInfiniteOpen(true);
    } else if (method === "hosted") {
      setHostedTarget(chooserTarget);
      setHostedOpen(true);
    } else {
      setReconnectTarget(chooserTarget);
      setConnectInitialMode(method === "manual" ? "manual" : "extension");
      setConnectOpen(true);
    }
  };
  // Secondary link inside the hosted modal ("connect another way") → back to chooser.
  const openOtherWays = (target: AccountView | null): void => {
    setHostedOpen(false);
    setChooserTarget(target);
    setChooserOpen(true);
  };

  const setStatus = async (account: AccountView, action: "pause" | "resume"): Promise<void> => {
    setActionError(null);
    try {
      await api.request(`/accounts/${account.id}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, `Could not ${action} account`));
    }
  };

  const confirmDisconnect = async (): Promise<void> => {
    if (!disconnectTarget) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.request(`/accounts/${disconnectTarget.id}/disconnect`, { method: "POST" });
      setDisconnectTarget(null);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not disconnect account"));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.request(`/accounts/${removeTarget.id}`, { method: "DELETE" });
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not remove account"));
    } finally {
      setBusy(false);
    }
  };

  if (!activeWorkspaceId) {
    return (
      <p className="text-sm text-muted-foreground">
        Create or select a workspace to connect an account.
      </p>
    );
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading accounts…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-tight">
            LinkedIn accounts{linkedInAccounts.length > 0 ? ` (${linkedInAccounts.length})` : ""}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Account safety is the priority — each account gets its own region-matched proxy and is
            paced independently to stay healthy. Connect as many accounts as your plan allows.
          </p>
        </div>
        <Button onClick={() => openConnect(null)} className="shrink-0">
          <Puzzle />
          Connect account
        </Button>
      </div>

      {actionError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <IncidentNotices notices={notices} onDismiss={dismissNotice} />

      {linkedInAccounts.length === 0 ? (
        <div className="surface-card flex flex-col items-center border-dashed p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-7" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">Connect your first LinkedIn account</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Log in once — no password to hand over. We run the automation for you, warm the account
            up gradually, and never exceed safe daily limits. Add more accounts any time.
          </p>
          <Button className="mt-5" onClick={() => openConnect(null)}>
            Connect account
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {linkedInAccounts.map((acct) => (
            <AccountCard
              key={acct.id}
              account={acct}
              onReconnect={() => openConnect(acct)}
              onStatus={(action) => void setStatus(acct, action)}
              onDisconnect={() => setDisconnectTarget(acct)}
              onRemove={() => setRemoveTarget(acct)}
            />
          ))}
        </div>
      )}

      {/* Safety engine reassurance — first-class, always visible */}
      <div className="flex items-start gap-3 rounded-2xl border border-success/20 bg-success/[0.06] p-4">
        <ShieldCheck className="mt-0.5 size-[17px] shrink-0 text-success" />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">How the safety engine protects you.</strong>{" "}
          Each account warms up gradually, respects human-like daily limits, and auto-pauses on any
          LinkedIn checkpoint — so you never risk a restriction. The score reflects sending velocity,
          acceptance, and account age.
        </p>
      </div>

      <HostedAuthModal
        open={hostedOpen}
        existing={hostedTarget}
        onClose={() => setHostedOpen(false)}
        onConnected={load}
        createLink={(body) =>
          api.request<{ url: string; expiresAt: string }>("/accounts/hosted-auth", {
            method: "POST",
            body,
          })
        }
        onOtherWays={() => openOtherWays(hostedTarget)}
      />

      <ConnectChooserModal
        open={chooserOpen}
        isReconnect={chooserTarget != null}
        onClose={() => setChooserOpen(false)}
        onPick={pickMethod}
      />

      <ConnectModal
        open={connectOpen}
        existing={reconnectTarget}
        initialMode={connectInitialMode}
        onClose={() => setConnectOpen(false)}
        onConnected={async (res) => {
          setGuidance(res.guidance);
          await load();
        }}
        connect={(body) => api.request<ConnectResponse>("/accounts/connect", { method: "POST", body })}
      />

      <InfiniteLoginModal
        open={infiniteOpen}
        existing={infiniteTarget}
        onClose={() => setInfiniteOpen(false)}
        onConnected={async (res) => {
          setGuidance(res.guidance);
          await load();
        }}
        connect={(body) => api.request<ConnectResponse>("/accounts/connect", { method: "POST", body })}
        onOtherWays={() => {
          setInfiniteOpen(false);
          setChooserTarget(infiniteTarget);
          setChooserOpen(true);
        }}
      />

      <Modal
        open={guidance !== null}
        onClose={() => setGuidance(null)}
        title="Account connected"
        description={guidance?.summary}
      >
        <div className="space-y-3">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {guidance?.steps.map((step) => <li key={step}>{step}</li>)}
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => setGuidance(null)}>Got it</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={disconnectTarget !== null}
        onClose={() => (busy ? undefined : setDisconnectTarget(null))}
        title="Disconnect account"
        description={`Disconnect ${disconnectTarget?.name ?? "this account"}? Its campaigns stop sending immediately.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDisconnectTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirmDisconnect()} disabled={busy}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={removeTarget !== null}
        onClose={() => (busy ? undefined : setRemoveTarget(null))}
        title="Remove account"
        description={`Permanently remove ${removeTarget?.name ?? "this account"}? This deletes its conversations and the contacts it sourced, and detaches its campaigns. This can't be undone. To just pause it, use Disconnect instead.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirmRemove()} disabled={busy}>
            {busy ? "Removing…" : "Remove account"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

type HostedOutcome = "success" | "failure" | "unknown";

/**
 * Resolve when the Hosted Auth popup signals completion: either the
 * /connect/callback page postMessages back (carrying success/failure), the popup
 * is closed, or a hard timeout elapses. "unknown" = we never got an explicit
 * signal (popup closed / timed out) — the account only appears if the provider
 * webhook succeeded, so the caller re-checks the list.
 */
function waitForHostedCompletion(popup: Window | null): Promise<HostedOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: HostedOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as { source?: string; status?: string } | null;
      if (data && data.source === "10xconnect-hosted-auth") {
        finish(data.status === "failure" ? "failure" : "success");
      }
    };
    window.addEventListener("message", onMessage);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if ((popup && popup.closed) || Date.now() - startedAt > 3 * 60_000) {
        finish("unknown");
      }
    }, 1000);
  });
}

type HostedAuthPhase = "idle" | "connecting";

/** One LinkedIn account in the multi-account grid: health ring, identity, pacing, actions. */
function AccountCard({
  account,
  onReconnect,
  onStatus,
  onDisconnect,
  onRemove,
}: {
  account: AccountView;
  onReconnect: () => void;
  onStatus: (action: "pause" | "resume") => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const needsReconnect = account.status === "restricted" || account.status === "disconnected";
  const title = account.label || account.name || "LinkedIn account";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        <HealthRing score={account.health_score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            {/* Profile photo with a LinkedIn channel badge. */}
            <span className="relative shrink-0">
              <Avatar name={title} src={account.avatar_url} size="md" />
              <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-chart-2 ring-2 ring-card">
                <Linkedin className="size-2 fill-current text-white" />
              </span>
            </span>
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {account.country ? <span>{account.country}</span> : null}
            {account.country ? <span>·</span> : null}
            <span>{account.connection_method ? METHOD_LABEL[account.connection_method] : "—"}</span>
            {account.proxy_type ? (
              <>
                <span>·</span>
                <span>{account.proxy_type === "bundled" ? "Bundled proxy" : "Own proxy"}</span>
              </>
            ) : null}
          </div>
        </div>
        <StatusBadge status={account.status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account actions" className="shrink-0">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onReconnect}>Reconnect</DropdownMenuItem>
            {account.status === "paused" ? (
              <DropdownMenuItem onSelect={() => onStatus("resume")}>Resume</DropdownMenuItem>
            ) : account.status === "active" || account.status === "warming" ? (
              <DropdownMenuItem onSelect={() => onStatus("pause")}>Pause</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onDisconnect}
            >
              Disconnect
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onRemove}
            >
              Remove account…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-muted-foreground">
          Daily pacing · safe limits
        </span>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn("h-full rounded-full", healthTone(account.health_score).track)}
            style={{ width: `${Math.max(6, Math.min(100, account.health_score))}%` }}
          />
        </div>
      </div>

      {needsReconnect ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <span className="text-destructive">
            This account is {account.status}. Reconnect to resume — campaigns are kept.
          </span>
          <Button size="sm" onClick={onReconnect}>
            <RefreshCw />
            Reconnect
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The four connect methods the chooser routes to. */
type ConnectChoice = "infinite" | "hosted" | "extension" | "manual";

/** Equal-option connect chooser: Infinite login / Hosted login / Extension / Paste li_at. */
function ConnectChooserModal({
  open,
  isReconnect,
  onClose,
  onPick,
}: {
  open: boolean;
  isReconnect: boolean;
  onClose: () => void;
  onPick: (method: ConnectChoice) => void;
}) {
  const options: {
    key: ConnectChoice;
    icon: typeof Linkedin;
    title: string;
    desc: string;
    badge?: string;
    devOnly?: boolean;
  }[] = [
    {
      key: "infinite",
      icon: InfinityIcon,
      title: "Infinite login",
      desc: "Stays connected — we log in with your LinkedIn credentials + 2FA and silently re-authenticate whenever the session drops. No more reconnecting. Requires authenticator-app 2FA.",
      badge: "Best · stays connected",
    },
    {
      key: "hosted",
      icon: ShieldCheck,
      title: "Log in on LinkedIn",
      desc: "Log in once on LinkedIn's secure page in a popup. No password shared, no extension.",
      badge: "No password",
    },
    {
      key: "extension",
      icon: Puzzle,
      title: "Browser extension",
      desc: "Connect through the 10xConnect extension — it rides your real signed-in session.",
    },
    {
      key: "manual",
      icon: ExternalLink,
      title: "Paste li_at cookie",
      desc: "Advanced/testing: paste your li_at session cookie + matching user-agent manually.",
      devOnly: true,
    },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReconnect ? "Reconnect LinkedIn" : "Connect a LinkedIn account"}
      description="Choose how you'd like to connect. All methods are safe — pick whatever's easiest for you."
    >
      <div className="space-y-2.5">
        {options
          .filter((o) => !o.devOnly || MANUAL_CONNECT_ENABLED)
          .map((o) => (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              className="flex w-full items-start gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left transition-colors hover:border-input hover:bg-accent"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <o.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {o.title}
                  {o.badge ? <Badge variant="success">{o.badge}</Badge> : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          ))}
      </div>
    </Modal>
  );
}

function HostedAuthModal({
  open,
  existing,
  onClose,
  onConnected,
  createLink,
  onOtherWays,
}: {
  open: boolean;
  existing: AccountView | null;
  onClose: () => void;
  onConnected: () => Promise<void>;
  createLink: (body: { country: string; reconnectAccountId?: string }) => Promise<{
    url: string;
    expiresAt: string;
  }>;
  onOtherWays: () => void;
}) {
  const [country, setCountry] = useState("US");
  const [phase, setPhase] = useState<HostedAuthPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const isReconnect = existing != null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setCountry(existing?.country ?? "US");
    setPhase("idle");
    setError(null);
  }, [open, existing]);

  const busy = phase !== "idle";
  const close = (): void => {
    if (!busy) {
      onClose();
    }
  };

  const start = (): void => {
    if (busy) {
      return;
    }
    setError(null);
    // Open the popup SYNCHRONOUSLY (within the click) to dodge popup blockers,
    // then navigate it to the hosted URL once the API returns it.
    const popup = window.open("about:blank", "10xconnect-linkedin", "width=520,height=720");
    setPhase("connecting");
    void (async () => {
      try {
        const { url } = await createLink({
          country: country.trim().toUpperCase(),
          ...(existing ? { reconnectAccountId: existing.id } : {}),
        });
        if (popup) {
          popup.location.href = url;
        } else {
          window.open(url, "10xconnect-linkedin");
        }
        const outcome = await waitForHostedCompletion(popup);
        if (outcome === "failure") {
          // LinkedIn login was cancelled or a checkpoint failed — do NOT claim
          // connected. The account list is unchanged.
          setError(
            "LinkedIn didn't complete the connection (login cancelled or a security checkpoint). Please try again.",
          );
          return;
        }
        // success / unknown → refresh; the account appears once the provider
        // webhook finalizes it.
        await onConnected();
        onClose();
      } catch (err) {
        popup?.close();
        setError(errorMessage(err, "Could not start the LinkedIn connection"));
      } finally {
        setPhase("idle");
      }
    })();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={isReconnect ? "Reconnect LinkedIn" : "Connect LinkedIn"}
      description="Log in once on LinkedIn's secure page in a popup. No password is shared with us and your account stays signed in — the lowest-friction, most stable way to connect."
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="hosted-country">Account country</Label>
          <Select
            id="hosted-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={busy}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Pick where this account normally signs in — we route it through a stable, region-matched
            proxy, which is what stops LinkedIn&apos;s &quot;impossible travel&quot; logouts.
          </p>
        </div>

        <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Info className="size-3.5" />
            What happens next
          </div>
          <ul className="list-disc space-y-1 pl-4">
            <li>A popup opens LinkedIn&apos;s secure login (handle any 2FA there).</li>
            <li>It closes automatically and your account appears here, warming up.</li>
            <li>Keep 2FA on; don&apos;t sign out of LinkedIn or change the password afterwards.</li>
          </ul>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOtherWays}
            disabled={busy}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Connect another way
          </button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={start} disabled={busy}>
              {phase === "connecting"
                ? "Waiting for LinkedIn…"
                : isReconnect
                  ? "Reconnect with LinkedIn"
                  : "Continue to LinkedIn"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

type ProxyBody =
  | { mode: "bundled"; region?: string }
  | { mode: "own"; region?: string; url: string };
type ConnectBody = {
  method: "extension" | "cookie";
  country: string;
  email?: string;
  liAt: string;
  userAgent: string;
  proxy: ProxyBody;
  /** Set to refresh a specific account (reconnect); omit to connect a new one. */
  reconnectAccountId?: string;
  label?: string;
};

type ConnectPhase = "idle" | "capturing" | "connecting";
type ConnectMode = "extension" | "manual";

// scheme://[user:pass@]host:port — mirrors the server-side PROXY_URL_RE so an
// invalid own-proxy is caught before we ever call the API (clear, instant error).
const PROXY_URL_RE = /^(https?|socks5h?):\/\/([^\s:@/]+(:[^\s@/]*)?@)?[^\s:@/]+:\d{2,5}$/i;

// The manual li_at path is a testing affordance — the extension is the product
// method. Shown only outside production, or when explicitly enabled.
const MANUAL_CONNECT_ENABLED =
  process.env.NEXT_PUBLIC_ALLOW_MANUAL_CONNECT === "true" ||
  process.env.NODE_ENV !== "production";

function ConnectModal({
  open,
  existing,
  initialMode = "extension",
  onClose,
  onConnected,
  connect,
}: {
  open: boolean;
  existing: AccountView | null;
  initialMode?: ConnectMode;
  onClose: () => void;
  onConnected: (res: ConnectResponse) => Promise<void>;
  connect: (body: ConnectBody) => Promise<ConnectResponse>;
}) {
  const [mode, setMode] = useState<ConnectMode>(initialMode);
  const [country, setCountry] = useState("US");
  const [liAt, setLiAt] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [proxyMode, setProxyMode] = useState<"bundled" | "own">("bundled");
  const [proxyUrl, setProxyUrl] = useState("");
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  // null = not checked yet; the modal probes for the extension when it opens.
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);

  const isReconnect = existing != null;

  // Prefill from the existing account on (re)open, then probe for the extension.
  useEffect(() => {
    if (!open) {
      return;
    }
    setMode(initialMode);
    setCountry(existing?.country ?? "US");
    setLiAt("");
    // Default the user-agent to THIS browser — for the manual path it must match
    // the browser the li_at was copied from (the top anti-logout lever).
    setUserAgent(typeof navigator !== "undefined" ? navigator.userAgent : "");
    setProxyMode(existing?.proxy_type === "own" ? "own" : "bundled");
    setProxyUrl("");
    setPhase("idle");
    setError(null);
    setExtInstalled(null);
    let active = true;
    void detectExtension().then((found) => {
      if (active) {
        setExtInstalled(found);
      }
    });
    return () => {
      active = false;
    };
  }, [open, existing, initialMode]);

  const busy = phase !== "idle";

  const close = (): void => {
    if (busy) {
      return;
    }
    onClose();
  };

  const recheckExtension = async (): Promise<void> => {
    setExtInstalled(null);
    setError(null);
    setExtInstalled(await detectExtension());
  };

  const proxyUrlValid = PROXY_URL_RE.test(proxyUrl.trim());
  const proxyValid = proxyMode === "bundled" || proxyUrlValid;
  const manualValid = liAt.trim().length >= 20 && userAgent.trim().length > 0;
  const valid =
    country.trim().length >= 2 && proxyValid && (mode === "extension" || manualValid);

  const onConnect = async (): Promise<void> => {
    if (busy || !valid) {
      return;
    }
    setError(null);
    const proxy: ProxyBody =
      proxyMode === "own" ? { mode: "own", url: proxyUrl.trim() } : { mode: "bundled" };
    try {
      let body: ConnectBody;
      if (mode === "manual") {
        // Testing path: the user pasted their li_at + the matching user-agent.
        setPhase("connecting");
        body = {
          method: "cookie",
          country: country.trim(),
          liAt: liAt.trim(),
          userAgent: userAgent.trim(),
          proxy,
          ...(existing ? { reconnectAccountId: existing.id } : {}),
        };
      } else {
        // Capture the li_at session from the user's logged-in LinkedIn tab,
        // then hand it (plus this browser's user-agent) to the API.
        setPhase("capturing");
        const captured = await captureLinkedInSession();
        setPhase("connecting");
        body = {
          method: "extension",
          country: country.trim(),
          liAt: captured.liAt,
          userAgent: navigator.userAgent,
          proxy,
          ...(existing ? { reconnectAccountId: existing.id } : {}),
        };
      }
      const res = await connect(body);
      await onConnected(res);
      onClose();
    } catch (err) {
      if (err instanceof ExtensionError && err.code === "not_installed") {
        setExtInstalled(false);
      }
      setError(errorMessage(err, "Could not connect the account"));
    } finally {
      setPhase("idle");
    }
  };

  const submitLabel =
    phase === "capturing"
      ? "Capturing session…"
      : phase === "connecting"
        ? "Connecting…"
        : mode === "manual"
          ? isReconnect
            ? "Reconnect with li_at"
            : "Connect with li_at"
          : isReconnect
            ? "Reconnect with extension"
            : "Connect with extension";

  return (
    <Modal
      open={open}
      onClose={close}
      title={isReconnect ? "Reconnect LinkedIn" : "Connect LinkedIn"}
      description={
        isReconnect
          ? "Refresh the session for this account. Your campaigns and history are kept — we just re-capture a fresh, signed-in session."
          : "Connect your LinkedIn account using your real, signed-in session — no password required. Keeping the session, IP region, and user-agent consistent is what stops repeated logouts."
      }
    >
      <div className="space-y-4">
        {MANUAL_CONNECT_ENABLED ? (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["extension", "Browser extension"],
                ["manual", "Paste li_at (testing)"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-50",
                  mode === m ? "border-primary bg-primary/5" : "hover:bg-accent",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "extension" && extInstalled === false ? (
          <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Puzzle className="size-4" />
              Install the 10xConnect extension
            </div>
            <p className="text-muted-foreground">
              The extension securely reads your signed-in LinkedIn session so we never handle your
              password. Add it from the Chrome Web Store, make sure you&apos;re signed in to LinkedIn
              in this browser, then re-check.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => window.open(EXTENSION_STORE_URL, "_blank", "noopener")}>
                <ExternalLink />
                Add to Chrome
              </Button>
              <Button variant="outline" size="sm" onClick={() => void recheckExtension()}>
                <RefreshCw />
                I&apos;ve installed it — re-check
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="acct-country">Account country</Label>
          <Select
            id="acct-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={busy}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Pick where this account normally signs in. We match a residential proxy to this region —
            a stable, region-matched IP is what stops LinkedIn&apos;s &quot;impossible travel&quot;
            logouts.
          </p>
        </div>

        {mode === "manual" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="acct-liat">LinkedIn session cookie (li_at)</Label>
              <Textarea
                id="acct-liat"
                value={liAt}
                onChange={(e) => setLiAt(e.target.value)}
                placeholder="AQEDAR…  (the value of the li_at cookie)"
                rows={3}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                In the browser you&apos;re signed in to LinkedIn: DevTools → Application → Cookies →
                https://www.linkedin.com → copy the <code>li_at</code> value. We verify it with the
                provider and refuse the connection if LinkedIn rejects it.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-ua">Browser user-agent</Label>
              <Input
                id="acct-ua"
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
                placeholder="Mozilla/5.0 …"
                autoComplete="off"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                Pre-filled with this browser. It MUST match the browser the <code>li_at</code> came
                from — a user-agent mismatch is the #1 cause of repeated logouts.
              </p>
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label>Proxy</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["bundled", "own"] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => setProxyMode(p)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm capitalize transition-colors disabled:opacity-50",
                  proxyMode === p ? "border-primary bg-primary/5" : "hover:bg-accent",
                )}
              >
                {p === "bundled" ? "Use our proxy" : "Use my own"}
              </button>
            ))}
          </div>
          {proxyMode === "own" ? (
            <>
              <Input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://user:pass@host:port"
                autoComplete="off"
                disabled={busy}
              />
              {proxyUrl.trim().length > 0 && !proxyUrlValid ? (
                <p className="mt-1 text-xs text-destructive">
                  Use scheme://[user:pass@]host:port — e.g. http://user:pass@host:8080 or
                  socks5://host:1080.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Stay-connected precautions — the difference between a stable account and
            one LinkedIn logs out repeatedly. */}
        <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Info className="size-3.5" />
            Keep this account from getting logged out
          </div>
          <ul className="list-disc space-y-1 pl-4">
            <li>Keep 2FA on; don&apos;t sign out of LinkedIn or use &quot;sign out of all sessions.&quot;</li>
            <li>Set the country to where the account actually signs in, and keep the same proxy.</li>
            <li>Don&apos;t change the password or log in from many different networks/devices.</li>
            <li>New accounts warm up gradually — we never exceed safe daily limits.</li>
          </ul>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onConnect()} disabled={!valid || busy}>
            {mode === "manual" ? null : <Puzzle />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type CredentialsConnectBody = {
  method: "credentials";
  country: string;
  email: string;
  password: string;
  totpSecret?: string;
  proxy: ProxyBody;
  /** Set to refresh a specific account (reconnect); omit to connect a new one. */
  reconnectAccountId?: string;
  label?: string;
};

/**
 * Infinite login (CLAUDE.md §6): connect with LinkedIn email + password + the
 * authenticator-app TOTP secret. Because we hold the credentials + 2FA secret, we
 * silently re-authenticate whenever LinkedIn drops the session — the account stays
 * connected. Gated on authenticator-app 2FA (not SMS), mirroring the provider's
 * requirement. Password + TOTP secret are sent once and stored encrypted at rest.
 */
function InfiniteLoginModal({
  open,
  existing,
  onClose,
  onConnected,
  connect,
  onOtherWays,
}: {
  open: boolean;
  existing: AccountView | null;
  onClose: () => void;
  onConnected: (res: ConnectResponse) => Promise<void>;
  connect: (body: CredentialsConnectBody) => Promise<ConnectResponse>;
  onOtherWays: () => void;
}) {
  const [stage, setStage] = useState<"gate" | "form">("gate");
  const [country, setCountry] = useState("US");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [proxyMode, setProxyMode] = useState<"bundled" | "own">("bundled");
  const [proxyUrl, setProxyUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReconnect = existing != null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setStage("gate");
    setCountry(existing?.country ?? "US");
    setEmail("");
    setPassword("");
    setTotpSecret("");
    setProxyMode(existing?.proxy_type === "own" ? "own" : "bundled");
    setProxyUrl("");
    setConnecting(false);
    setError(null);
  }, [open, existing]);

  const close = (): void => {
    if (!connecting) {
      onClose();
    }
  };

  const proxyUrlValid = PROXY_URL_RE.test(proxyUrl.trim());
  const proxyValid = proxyMode === "bundled" || proxyUrlValid;
  const valid =
    country.trim().length >= 2 &&
    /.+@.+\..+/.test(email.trim()) &&
    password.length >= 1 &&
    // TOTP secret is what makes login "infinite" — required here (it's the whole point).
    totpSecret.trim().length >= 8 &&
    proxyValid;

  const submit = async (): Promise<void> => {
    if (connecting || !valid) {
      return;
    }
    setError(null);
    setConnecting(true);
    const proxy: ProxyBody =
      proxyMode === "own" ? { mode: "own", url: proxyUrl.trim() } : { mode: "bundled" };
    try {
      const res = await connect({
        method: "credentials",
        country: country.trim(),
        email: email.trim(),
        password,
        totpSecret: totpSecret.trim(),
        proxy,
        ...(existing ? { reconnectAccountId: existing.id } : {}),
      });
      await onConnected(res);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Could not connect the account"));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={isReconnect ? "Reconnect with Infinite login" : "Infinite login"}
      description="Stay connected: we sign the account in and silently re-authenticate whenever LinkedIn drops the session — no more reconnecting."
    >
      {stage === "gate" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
            <InfinityIcon className="mt-0.5 size-[18px] shrink-0 text-primary" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Infinite login needs <strong className="text-foreground">authenticator-app 2FA</strong>{" "}
              (TOTP — e.g. Google Authenticator / Authy) enabled on the account. That&apos;s what lets
              us solve LinkedIn&apos;s security checkpoint for you and re-log in automatically. SMS 2FA
              won&apos;t work.
            </p>
          </div>
          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Info className="size-3.5" />
              Turn on authenticator 2FA (if you haven&apos;t)
            </div>
            <ul className="list-disc space-y-1 pl-4">
              <li>LinkedIn → Settings &amp; Privacy → Sign in &amp; security → Two-step verification.</li>
              <li>Choose <strong>Authenticator app</strong>, and keep the setup key (the base32 secret) — you&apos;ll paste it next.</li>
            </ul>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onOtherWays}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Connect another way
            </button>
            <Button type="button" onClick={() => setStage("form")}>
              I have authenticator 2FA — continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inf-email">LinkedIn email</Label>
            <Input
              id="inf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="off"
              disabled={connecting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inf-password">LinkedIn password</Label>
            <Input
              id="inf-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="off"
              disabled={connecting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inf-totp">Authenticator 2FA secret (setup key)</Label>
            <Input
              id="inf-totp"
              value={totpSecret}
              onChange={(e) => setTotpSecret(e.target.value)}
              placeholder="JBSWY3DPEHPK3PXP"
              autoComplete="off"
              spellCheck={false}
              disabled={connecting}
            />
            <p className="text-xs text-muted-foreground">
              The base32 secret shown when you set up authenticator 2FA (not the 6-digit code). We
              store it encrypted and use it only to re-log in for you.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inf-country">Account country</Label>
            <Select
              id="inf-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={connecting}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Pick where this account normally signs in — it runs on a matching residential proxy, so
              LinkedIn never sees impossible travel.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Proxy</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["bundled", "own"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={connecting}
                  onClick={() => setProxyMode(p)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm capitalize transition-colors disabled:opacity-50",
                    proxyMode === p ? "border-primary bg-primary/5" : "hover:bg-accent",
                  )}
                >
                  {p === "bundled" ? "Use our proxy" : "Use my own"}
                </button>
              ))}
            </div>
            {proxyMode === "own" ? (
              <>
                <Input
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="http://user:pass@host:port"
                  autoComplete="off"
                  disabled={connecting}
                />
                {proxyUrl.trim().length > 0 && !proxyUrlValid ? (
                  <p className="mt-1 text-xs text-destructive">
                    Use scheme://[user:pass@]host:port — e.g. http://user:pass@host:8080 or
                    socks5://host:1080.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Your password + 2FA secret are encrypted at rest (AES-256-GCM) and never shown again.
              Don&apos;t change the account password afterwards — it invalidates the stored login.
            </span>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setStage("gate")}
              disabled={connecting}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={connecting}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={!valid || connecting}>
                <InfinityIcon />
                {connecting
                  ? "Connecting…"
                  : isReconnect
                    ? "Reconnect"
                    : "Connect with Infinite login"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
