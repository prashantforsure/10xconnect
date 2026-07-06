"use client";

// AGENCY OVERVIEW — a cross-CLIENT dashboard (HeyReach/Aimfox "manage all clients"
// + the #1 G2 ask, deeper reporting). Reads GET /agency/overview (auth-only,
// memberships-scoped), rolls up every workspace the user belongs to. "Open" jumps
// into a client's workspace via the same switcher the header uses.

import { ArrowUpRight, Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/loader";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

interface ClientRow {
  workspaceId: string;
  name: string;
  role: string;
  brand: { name: string | null; primaryColor: string | null; logoUrl: string | null };
  leads: number;
  activeCampaigns: number;
  totalCampaigns: number;
  connectionRequests: number;
  accepted: number;
  acceptRate: number;
  messages: number;
  replies: number;
  replyRate: number;
  accounts: { total: number; active: number; warming: number; paused: number; restricted: number };
  avgHealth: number | null;
  needsAttention: number;
}
interface Overview {
  totals: {
    clients: number;
    leads: number;
    activeCampaigns: number;
    connectionRequests: number;
    accepted: number;
    replies: number;
    connectedAccounts: number;
    needsAttention: number;
  };
  clients: ClientRow[];
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const num = (n: number): string => n.toLocaleString();

function healthTone(h: number | null): string {
  if (h === null) return "text-muted-foreground";
  if (h >= 70) return "text-success";
  if (h >= 40) return "text-warning";
  return "text-destructive";
}

export function AgencyClient() {
  const api = useApi();
  const router = useRouter();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.request<Overview>("/agency/overview"));
      setError(null);
    } catch {
      setError("Could not load the agency overview.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (workspaceId: string): void => {
    if (workspaceId !== activeWorkspaceId) {
      setActiveWorkspaceId(workspaceId);
    }
    router.push("/dashboard");
  };

  if (loading) {
    return <PageLoader />;
  }
  if (error || !data) {
    return <p className="text-sm text-destructive">{error ?? "No data"}</p>;
  }

  const { totals, clients } = data;

  return (
    <div className="space-y-6">
      {/* Agency totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Clients" value={num(totals.clients)} />
        <Stat label="Leads" value={num(totals.leads)} />
        <Stat label="Active campaigns" value={num(totals.activeCampaigns)} />
        <Stat label="Accepted" value={num(totals.accepted)} />
        <Stat label="Replies" value={num(totals.replies)} />
        <Stat
          label="Needs attention"
          value={num(totals.needsAttention)}
          highlight={totals.needsAttention > 0}
        />
      </div>

      {/* Per-client table */}
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/40">
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 text-right font-semibold">Leads</th>
                <th className="px-4 py-3 text-right font-semibold">Campaigns</th>
                <th className="px-4 py-3 text-right font-semibold">Accepted</th>
                <th className="px-4 py-3 text-right font-semibold">Replies</th>
                <th className="px-4 py-3 text-right font-semibold">Accounts</th>
                <th className="px-4 py-3 text-right font-semibold">Inbox</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const accent = c.brand.primaryColor && HEX.test(c.brand.primaryColor)
                  ? c.brand.primaryColor
                  : undefined;
                const display = c.brand.name || c.name;
                return (
                  <tr key={c.workspaceId} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    {/* Client identity */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {c.brand.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.brand.logoUrl}
                            alt={display}
                            className="size-7 shrink-0 rounded-md border object-contain"
                          />
                        ) : (
                          <span
                            className="grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold text-white"
                            style={{ background: accent ?? "hsl(var(--primary))" }}
                          >
                            {display.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-foreground">{display}</span>
                            {c.workspaceId === activeWorkspaceId ? (
                              <Badge variant="secondary" className="shrink-0">
                                Current
                              </Badge>
                            ) : null}
                          </div>
                          <span className="text-xs capitalize text-muted-foreground">{c.role}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(c.leads)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="text-foreground">{num(c.activeCampaigns)}</span>
                      <span className="text-muted-foreground"> / {num(c.totalCampaigns)}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {num(c.accepted)}
                      <span className="ml-1 text-xs text-muted-foreground">{c.acceptRate}%</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {num(c.replies)}
                      <span className="ml-1 text-xs text-muted-foreground">{c.replyRate}%</span>
                    </td>
                    {/* Account health */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular-nums">{num(c.accounts.total)}</span>
                        {c.avgHealth !== null ? (
                          <span className={cn("text-xs font-medium tabular-nums", healthTone(c.avgHealth))}>
                            {c.avgHealth}
                          </span>
                        ) : null}
                        {c.accounts.restricted > 0 ? (
                          <span
                            aria-hidden
                            title={`${c.accounts.restricted} restricted`}
                            className="size-2 rounded-full bg-destructive"
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.needsAttention > 0 ? (
                        <Badge variant="warning">{num(c.needsAttention)}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => open(c.workspaceId)}>
                        Open
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {clients.length <= 1 ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Building2 className="mt-0.5 size-4 shrink-0" />
          <p>
            This view aggregates every workspace you belong to. Create one workspace per client (top-left
            switcher → Create workspace) to manage them all from here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="surface-card p-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/40">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums",
          highlight ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
