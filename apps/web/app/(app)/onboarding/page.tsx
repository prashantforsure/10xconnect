"use client";

import { ArrowRight, Megaphone, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/[0.13] px-3 py-1 text-[11px] font-semibold text-success">
        <ShieldCheck className="size-3.5" />
        Account-safe by default
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        Welcome to 10xConnect 👋
      </h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Two quick steps and your first campaign is live. We&apos;ll keep your accounts safe along the
        way.
      </p>

      <div className="mt-8 space-y-4">
        <Step
          n={1}
          icon={<ShieldCheck className="size-5 text-primary" />}
          title="Connect your LinkedIn account"
          body="Click connect and log in to LinkedIn once on the secure hosted page — no password to hand over, no extension or third-party account needed. New accounts warm up automatically inside safe daily limits."
          href="/settings/accounts"
          cta="Connect account"
        />
        <Step
          n={2}
          icon={<Megaphone className="size-5 text-primary" />}
          title="Create your first campaign"
          body="Build a multi-step sequence, enroll a list of leads, and hit Run. Replies auto-stop the sequence and land in your inbox."
          href="/campaigns"
          cta="Create campaign"
        />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <a
          href="https://cal.com"
          target="_blank"
          rel="noreferrer"
          className="text-[13px] text-indigo-text hover:underline"
        >
          Book a call
        </a>
        <Link href="/dashboard">
          <Button variant="outline">
            Skip to dashboard
            <ArrowRight />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
  href,
  cta,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="surface-card flex items-start gap-4 p-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-[14.5px] font-semibold text-foreground">{title}</h2>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
        <Link href={href}>
          <Button className="mt-3" size="sm">
            {cta}
            <ArrowRight />
          </Button>
        </Link>
      </div>
    </div>
  );
}
