"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { INCLUDED_FEATURES } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

interface Subscription {
  status: string;
  slotCount: number;
  billingCycle: "monthly" | "annual";
  pricePerSlot: number;
  monthlyCost: number;
  /** True when this workspace is on the developer allowlist (full, free access). */
  developer?: boolean;
  /** True when sending-account slots are uncapped (developer access). */
  unlimited?: boolean;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function BillingClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [slots, setSlots] = useState(1);
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      const s = await api.request<Subscription>("/billing/subscription");
      setSub(s);
      setSlots(s.slotCount);
      setCycle(s.billingCycle);
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setMsg(null);
    try {
      const s = await api.request<Subscription>("/billing/slots", {
        method: "POST",
        body: { slotCount: slots, cycle },
      });
      setSub(s);
      setMsg("Saved");
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    }
  };

  const checkout = async (): Promise<void> => {
    setMsg(null);
    try {
      const res = await api.request<{ message: string }>("/billing/checkout", {
        method: "POST",
        body: { cycle },
      });
      setMsg(res.message);
    } catch (err) {
      setMsg(errorMessage(err, "Checkout unavailable"));
    }
  };

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const isDeveloper = sub?.developer === true;
  const pricePerSlot = isDeveloper ? 0 : cycle === "annual" ? 39 : 49;
  const cost = slots * pricePerSlot;

  return (
    <div className="space-y-6">
      {isDeveloper ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span className="font-semibold text-primary">Developer access</span> — full access to
          every feature, unlimited sending accounts, and no payment required. This override is
          scoped to your developer email.
        </div>
      ) : null}
      <div className="surface-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">Subscription</h2>
            <p className="text-xs text-muted-foreground">
              Status: <span className="capitalize">{sub?.status?.replace("_", " ") ?? "—"}</span>
            </p>
          </div>
          <div className="inline-flex rounded-full border bg-secondary p-1 text-xs">
            {(["monthly", "annual"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={cn(
                  "rounded-full px-3 py-1 font-medium capitalize transition-colors",
                  cycle === c
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="font-display text-4xl font-bold tracking-tight">
            ${cost}
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {slots} sending account{slots === 1 ? "" : "s"} × ${pricePerSlot}/mo
            {cycle === "annual" ? " (billed annually)" : ""}
          </p>
        </div>

        <div className="mt-5 max-w-md">
          <label className="text-xs font-medium text-muted-foreground">Sending account slots</label>
          <Slider
            value={slots}
            onValueChange={setSlots}
            min={1}
            max={20}
            className="mt-2"
            aria-label="Sending account slots"
          />
          <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
            <span>1</span>
            <span>
              {slots} slot{slots === 1 ? "" : "s"}
            </span>
            <span>20</span>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button variant="outline" onClick={() => void save()}>
            Save slots
          </Button>
          <Button onClick={() => void checkout()}>Buy / activate</Button>
          {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
        </div>
      </div>

      <div className="surface-card p-6">
        <h2 className="font-display text-base font-semibold">What&apos;s included</h2>
        <ul className="mt-3 grid gap-2.5 text-sm sm:grid-cols-2">
          {INCLUDED_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Billing is display-only in this MVP — connect a payment provider (Creem/Dodo) to take real
        payments.
      </p>
    </div>
  );
}
