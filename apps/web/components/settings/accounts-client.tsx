"use client";

import { ExternalLink, Info, MoreHorizontal, Puzzle, RefreshCw, ShieldCheck } from "lucide-react";
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
  proxy_type: "bundled" | "own" | null;
  proxy_region: string | null;
  country: string | null;
  status: AccountStatus;
  health_score: number;
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
  credentials: "Credentials",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

function StatusBadge({ status }: { status: AccountStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

function HealthDot({ score }: { score: number }) {
  const color = score >= 80 ? "bg-success" : score >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", color)} />
      {score}
    </span>
  );
}

export function AccountsClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [accounts, setAccounts] = useState<AccountView[]>([]);
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

  useEffect(() => {
    void load();
  }, [load]);

  const linkedInAccount = accounts.find((a) => a.type === "linkedin") ?? null;

  // Primary: Hosted Auth (lowest friction — one login on the provider's page).
  const openConnect = (target: AccountView | null): void => {
    setHostedTarget(target);
    setHostedOpen(true);
  };
  // Secondary: the extension / manual li_at modal ("connect another way").
  const openOtherWays = (target: AccountView | null): void => {
    setHostedOpen(false);
    setReconnectTarget(target);
    setConnectOpen(true);
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

  const needsReconnect =
    linkedInAccount != null &&
    (linkedInAccount.status === "restricted" || linkedInAccount.status === "disconnected");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          One LinkedIn account per workspace. Connect in one click — log in once, we handle the rest.
        </p>
        {linkedInAccount ? (
          <Button variant="outline" onClick={() => openConnect(linkedInAccount)}>
            <RefreshCw />
            Reconnect
          </Button>
        ) : (
          <Button onClick={() => openConnect(null)}>
            <Puzzle />
            Connect LinkedIn
          </Button>
        )}
      </div>

      {actionError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {!linkedInAccount ? (
        <div className="surface-card flex flex-col items-center border-dashed p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-7" />
          </span>
          <p className="mt-4 font-display text-lg font-semibold">Connect your LinkedIn account</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Click connect and log in to LinkedIn once on the secure hosted page — no password to
            hand over, no third-party account to set up. We run the automation for you, warm the
            account up gradually, and never exceed safe daily limits.
          </p>
          <Button className="mt-5" onClick={() => openConnect(null)}>
            Connect LinkedIn
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {needsReconnect ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <span className="text-destructive">
                This account is {linkedInAccount.status}. Reconnect to resume outreach — your
                campaigns and history are kept.
              </span>
              <Button size="sm" onClick={() => openConnect(linkedInAccount)}>
                <RefreshCw />
                Reconnect
              </Button>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            <div className="flex items-center gap-3 px-4 py-3">
              <Avatar name={linkedInAccount.name ?? undefined} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {linkedInAccount.name ?? "LinkedIn account"}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {linkedInAccount.country ? <span>{linkedInAccount.country}</span> : null}
                  <span>·</span>
                  <span>
                    {linkedInAccount.connection_method
                      ? METHOD_LABEL[linkedInAccount.connection_method]
                      : "—"}
                  </span>
                  {linkedInAccount.proxy_type ? (
                    <>
                      <span>·</span>
                      <span>
                        {linkedInAccount.proxy_type === "bundled" ? "Bundled proxy" : "Own proxy"}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <HealthDot score={linkedInAccount.health_score} />
              <StatusBadge status={linkedInAccount.status} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Account actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => openConnect(linkedInAccount)}>
                    Reconnect
                  </DropdownMenuItem>
                  {linkedInAccount.status === "paused" ? (
                    <DropdownMenuItem onSelect={() => void setStatus(linkedInAccount, "resume")}>
                      Resume
                    </DropdownMenuItem>
                  ) : linkedInAccount.status === "active" || linkedInAccount.status === "warming" ? (
                    <DropdownMenuItem onSelect={() => void setStatus(linkedInAccount, "pause")}>
                      Pause
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDisconnectTarget(linkedInAccount)}
                  >
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      )}

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

      <ConnectModal
        open={connectOpen}
        existing={reconnectTarget}
        onClose={() => setConnectOpen(false)}
        onConnected={async (res) => {
          setGuidance(res.guidance);
          await load();
        }}
        connect={(body) => api.request<ConnectResponse>("/accounts/connect", { method: "POST", body })}
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
    </div>
  );
}

/**
 * Resolve when the Hosted Auth popup signals completion: either the
 * /connect/callback page postMessages back, the popup is closed, or a hard
 * timeout elapses. We refresh the account list either way.
 */
function waitForHostedCompletion(popup: Window | null): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      resolve();
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as { source?: string } | null;
      if (data && data.source === "10xconnect-hosted-auth") {
        finish();
      }
    };
    window.addEventListener("message", onMessage);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if ((popup && popup.closed) || Date.now() - startedAt > 3 * 60_000) {
        finish();
      }
    }, 1000);
  });
}

type HostedAuthPhase = "idle" | "connecting";

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
  createLink: (body: { country: string }) => Promise<{ url: string; expiresAt: string }>;
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
        const { url } = await createLink({ country: country.trim().toUpperCase() });
        if (popup) {
          popup.location.href = url;
        } else {
          window.open(url, "10xconnect-linkedin");
        }
        await waitForHostedCompletion(popup);
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
};

type ConnectPhase = "idle" | "capturing" | "connecting";
type ConnectMode = "extension" | "manual";

// The manual li_at path is a testing affordance — the extension is the product
// method. Shown only outside production, or when explicitly enabled.
const MANUAL_CONNECT_ENABLED =
  process.env.NEXT_PUBLIC_ALLOW_MANUAL_CONNECT === "true" ||
  process.env.NODE_ENV !== "production";

function ConnectModal({
  open,
  existing,
  onClose,
  onConnected,
  connect,
}: {
  open: boolean;
  existing: AccountView | null;
  onClose: () => void;
  onConnected: (res: ConnectResponse) => Promise<void>;
  connect: (body: ConnectBody) => Promise<ConnectResponse>;
}) {
  const [mode, setMode] = useState<ConnectMode>("extension");
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
    setMode("extension");
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
  }, [open, existing]);

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

  const proxyValid = proxyMode === "bundled" || proxyUrl.trim().length > 0;
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
            <Input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://user:pass@host:port"
              autoComplete="off"
              disabled={busy}
            />
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
