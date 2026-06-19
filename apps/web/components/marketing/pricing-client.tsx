"use client";

import { ArrowRight, Building2, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  type BillingCycle,
  billedNow,
  INCLUDED_FEATURES,
  monthlyCost,
  PRICE_PER_SLOT,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function PricingClient() {
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  const [slots, setSlots] = useState(2);

  const perMonth = monthlyCost(slots, cycle);
  const annualTotal = billedNow(slots, "annual");

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="default">Pricing</Badge>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Simple pricing that scales with your accounts
        </h1>
        <p className="mt-4 text-muted-foreground">
          Pay per sending account. Campaigns, contacts, messages and team members are unlimited — and
          a residential proxy is bundled with every account.
        </p>
      </div>

      {/* Cycle toggle */}
      <div className="mt-8 flex justify-center">
        <div className="inline-flex rounded-full border bg-card p-1 text-sm shadow-soft">
          {(["monthly", "annual"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={cn(
                "rounded-full px-5 py-2 font-medium capitalize transition-colors",
                cycle === c
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
              {c === "annual" ? <span className="ml-1 text-xs opacity-80">save 20%</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-6 lg:grid-cols-2">
        {/* Featured self-serve calculator */}
        <div className="relative rounded-3xl border-2 border-primary bg-card p-8 shadow-soft-md">
          <Badge variant="default" className="absolute -top-3 left-8">
            Most popular
          </Badge>
          <h2 className="font-display text-xl font-semibold">Self-serve</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything included. Scale accounts up or down anytime.
          </p>

          <div className="mt-6 flex items-end gap-1">
            <span className="font-display text-5xl font-bold tracking-tight">${perMonth}</span>
            <span className="mb-1.5 text-sm text-muted-foreground">/month</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {slots} sending account{slots === 1 ? "" : "s"} × ${PRICE_PER_SLOT[cycle]}/mo
            {cycle === "annual" ? ` · billed $${annualTotal.toLocaleString()}/yr` : ""}
          </p>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Sending accounts</span>
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-primary">{slots}</span>
            </div>
            <Slider value={slots} onValueChange={setSlots} min={1} max={20} aria-label="Sending accounts" />
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>20</span>
            </div>
          </div>

          <Button asChild size="lg" className="mt-7 w-full rounded-full">
            <Link href="/signup">
              Start free <ArrowRight className="size-4" />
            </Link>
          </Button>

          <ul className="mt-7 space-y-2.5 text-sm">
            {INCLUDED_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Enterprise / agency */}
        <div className="flex flex-col rounded-3xl border bg-card p-8 shadow-soft">
          <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-foreground">
            <Building2 className="size-5" />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold">Agency &amp; Enterprise</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For teams running 20+ accounts or managing outreach for clients.
          </p>

          <div className="mt-6 flex items-end gap-1">
            <span className="font-display text-5xl font-bold tracking-tight">Custom</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Volume pricing &amp; white-label options.</p>

          <Button asChild size="lg" variant="outline" className="mt-7 w-full rounded-full">
            <Link href="/signup">Talk to us</Link>
          </Button>

          <ul className="mt-7 space-y-2.5 text-sm">
            {[
              "Everything in Self-serve",
              "Volume discounts on accounts",
              "White-label client surfaces",
              "Priority support & onboarding",
              "Custom integrations",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Members are always unlimited and free — you only pay per sending account. No metered sending
        credits, ever.
      </p>
    </section>
  );
}
