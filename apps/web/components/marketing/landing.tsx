import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  Clock,
  Gauge,
  GitBranch,
  Heart,
  Inbox,
  Mic,
  MessageCircle,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  UserPlus,
  Workflow,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Button } from "@/components/ui/button";
import { INCLUDED_FEATURES, PRICE_PER_SLOT } from "@/lib/pricing";

const INTEGRATIONS = ["HubSpot", "Salesforce", "Pipedrive", "Calendly", "Slack", "Zapier"];

const METRICS = [
  { value: "3×", label: "more replies with voice notes" },
  { value: "15", label: "requests/day, safely paced" },
  { value: "1", label: "inbox for every account" },
  { value: "99.9%", label: "idempotent — no double-sends" },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: "Account safety first",
    body: "A real rate governor, warm-up ramp, working-hours scheduler and health monitor keep your LinkedIn accounts out of jail. We refuse to exceed safe limits — even if you ask.",
  },
  {
    icon: Workflow,
    title: "Multi-step sequences",
    body: "Connection requests, messages, voice notes, likes, comments, InMails — branch on accepted invites and replies, with a visual builder.",
  },
  {
    icon: Bot,
    title: "AI personalization",
    body: "Generate a genuine, specific first line for every prospect from their profile. Observation + soft question — never salesy.",
  },
  {
    icon: Inbox,
    title: "Unified inbox",
    body: "Every reply auto-stops the sequence and lands in one inbox. Reply, tag, set pipeline stages, and book the call.",
  },
  {
    icon: Mic,
    title: "Native voice notes",
    body: "Send LinkedIn voice notes at scale — recorded or AI-cloned — the channel that actually gets replies.",
  },
  {
    icon: Zap,
    title: "LinkedIn + email",
    body: "Run LinkedIn today; email is a co-equal channel so your sequences reach people wherever they answer.",
  },
];

const STEPS = [
  { n: 1, title: "Import & enrich", body: "Bring leads from search, CSV, an event or post. We dedupe and enrich every profile." },
  { n: 2, title: "Build the sequence", body: "Drop in requests, messages, voice notes and waits. Branch on invites and replies." },
  { n: 3, title: "Run it safely", body: "The rate governor paces every account with human-like spacing in working hours." },
  { n: 4, title: "Auto-stop on reply", body: "Any reply instantly pauses that lead's sequence and routes it to your inbox." },
  { n: 5, title: "Reply & book", body: "Manage every conversation in one place, set stages, and book the call." },
];

const SAFETY: { icon: LucideIcon; label: string; value: string }[] = [
  { icon: Gauge, label: "Per-account daily caps", value: "Clamped to safe maxima" },
  { icon: Activity, label: "Live health score", value: "Acceptance + reply tracking" },
  { icon: Clock, label: "Working-hours scheduler", value: "4–8 min human spacing" },
  { icon: ShieldCheck, label: "Auto-pause on risk", value: "Within one dispatch cycle" },
];

const TESTIMONIALS = [
  {
    quote:
      "We finally scaled LinkedIn outreach without losing accounts. The safety engine is the whole reason we switched.",
    name: "Maya R.",
    role: "Head of Growth, B2B SaaS",
    initials: "MR",
    bg: "bg-primary",
  },
  {
    quote:
      "Voice notes at scale changed our reply rate overnight. The AI first line actually sounds like me.",
    name: "Daniel K.",
    role: "Founder, Agency",
    initials: "DK",
    bg: "bg-[#3C66E2]",
  },
  {
    quote:
      "One inbox across five sending accounts. Replies auto-stop the sequence — no more awkward double messages.",
    name: "Priya S.",
    role: "SDR Lead",
    initials: "PS",
    bg: "bg-[#743CE2]",
  },
];

const FAQ = [
  {
    q: "Will this get my LinkedIn account restricted?",
    a: "Automation always carries risk, but safety is our #1 design priority: per-account daily caps, gradual warm-up, human-like spacing, and auto-pause on any restriction signal. We never market guaranteed un-bannability.",
  },
  {
    q: "How is pricing structured?",
    a: "You pay per sending-account slot. Campaigns, contacts, messages and team members are unlimited, and a residential proxy is bundled with every slot.",
  },
  {
    q: "Do you support email too?",
    a: "LinkedIn ships first; email is a co-equal channel on the roadmap so you can run true cross-channel sequences.",
  },
  {
    q: "How are voice notes sent?",
    a: "As native LinkedIn voice notes — normally a mobile-only feature — recorded by you or generated from your AI voice clone, with per-prospect variables.",
  },
  {
    q: "Can my whole team use it?",
    a: "Yes. Members are unlimited and free — you only pay per sending account. Owners, admins and members have role-based access.",
  },
];

export function Landing() {
  return (
    <MarketingShell>
      {/* ----------------------------------- HERO ---------------------------------- */}
      <section className="relative mx-auto max-w-5xl px-6 pb-6 pt-16 text-center">
        <div
          className="glow pointer-events-none absolute left-1/2 top-[-40px] h-[380px] w-[760px] -translate-x-1/2"
          style={{ background: "radial-gradient(55% 60% at 50% 0%, hsl(var(--primary)/0.16), transparent)" }}
        />
        <div className="relative">
          <span className="eyebrow shadow-soft">
            <ShieldCheck className="size-3.5 text-primary" /> Safety-first LinkedIn + email outreach
          </span>
          <h1 className="mx-auto mt-6 max-w-[880px] text-balance font-display text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[58px]">
            Book more sales meetings from LinkedIn{" "}
            <span className="shine text-primary">without burning your accounts</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-balance text-lg leading-relaxed text-muted-foreground">
            10xConnect runs personalized, multi-step LinkedIn campaigns that turn cold leads into
            booked calls — with a safety engine that keeps every one of your accounts healthy.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="rounded-xl px-7 shadow-[0_6px_20px_-6px_hsl(var(--primary))]"
            >
              <Link href="/signup">
                Start free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl px-7">
              <Link href="#pricing">See pricing</Link>
            </Button>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground/80">
            No credit card required · Connect an account in minutes
          </p>
        </div>

        <HeroPreview />
      </section>

      {/* ------------------------------- TRUST STRIP ------------------------------- */}
      <section className="mt-10 border-y bg-card/50">
        <div className="mx-auto max-w-5xl px-6 py-7">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Built for sales teams, founders &amp; agencies running outreach at scale
          </p>
          <div className="mt-5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
            <div className="marquee-track items-center opacity-60">
              {[...INTEGRATIONS, ...INTEGRATIONS].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="whitespace-nowrap px-7 font-display text-lg font-bold text-[#635A4C]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------- METRICS --------------------------------- */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="reveal grid grid-cols-2 gap-6 text-center lg:grid-cols-4">
          {METRICS.map((m) => (
            <div key={m.label}>
              <div className="font-display text-5xl font-bold tracking-tight text-primary">
                {m.value}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------- PILLARS --------------------------------- */}
      <section id="features" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-12">
        <PillarRow
          eyebrow="Multi-step sequences"
          title="A visual builder for outreach that actually starts conversations"
          body="Chain connection requests, messages, voice notes, likes and comments. Branch on accepted invites and replies. Defaults favor a soft observation and a low-friction question — never a pitch."
          bullets={[
            "12 LinkedIn actions + email, all in one canvas",
            "Conditional branches: invite accepted, replied, opened",
            "Connection requests default to no note",
          ]}
          mock={<MockSequence />}
        />
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <PillarRow
          reverse
          eyebrow="AI personalization"
          title="A genuine first line for every prospect — at scale"
          body="We read each profile and write a specific, human observation plus a soft question. Preview across a sample before you ever hit send, and keep your brand voice consistent."
          bullets={[
            "Observation + soft question, never salesy",
            "Preview generated lines before activating",
            "Brand-voice prompt library",
          ]}
          mock={<MockPersonalization />}
        />
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <PillarRow
          eyebrow="Unified inbox"
          title="Every reply in one place — sequences stop automatically"
          body="The moment a prospect replies, their sequence pauses and the conversation lands in a unified inbox across all your accounts and channels. Tag, set pipeline stages, and book the call."
          bullets={[
            "Auto-stop on reply — no double messages",
            "Pipeline stages: new → qualified → booked",
            "Saved responses & lead enrichment panel",
          ]}
          mock={<MockInbox />}
        />
      </section>

      {/* ------------------------------- FEATURE GRID ------------------------------ */}
      <section className="border-t bg-card/50">
        <div className="mx-auto max-w-5xl px-6 py-[72px]">
          <div className="mx-auto max-w-xl text-center">
            <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              Everything you need
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
              One platform for safe, personalized outreach
            </h2>
          </div>
          <div className="mt-11 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="reveal surface-card p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-soft-lg"
              >
                <span className="flex size-[46px] items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------- HOW IT WORKS ------------------------------ */}
      <section id="how" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-[72px]">
        <div className="mx-auto max-w-xl text-center">
          <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            How it works
          </span>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
            From cold list to booked call
          </h2>
        </div>
        <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s) => (
            <div key={s.n} className="reveal surface-card p-5">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
                {s.n}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------- SAFETY MOAT ------------------------------ */}
      <section id="safety" className="scroll-mt-24 px-6 pb-12 pt-6">
        <div className="reveal relative mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-foreground px-8 py-14 text-[#F7F2E8] sm:px-14">
          <div
            className="pointer-events-none absolute -right-20 -top-20 size-[340px] rounded-full opacity-35"
            style={{ background: "radial-gradient(circle, hsl(var(--primary)), transparent 70%)" }}
          />
          <div className="relative grid items-center gap-12 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#F7F2E8]/20 px-3.5 py-1.5 text-xs font-semibold text-[#F7F2E8]/80">
                <ShieldCheck className="size-3.5 text-primary" /> The #1 priority
              </span>
              <h2 className="mt-5 font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[40px]">
                We refuse to burn your accounts
              </h2>
              <p className="mt-4 leading-relaxed text-[#F7F2E8]/70">
                A rate governor, working-hours scheduler, warm-up state machine and live health
                monitor are all ours — and they clamp or pause before they ever risk a restriction.
                Account safety is a lifecycle we design for, not an error we hit.
              </p>
              <Button asChild size="lg" className="mt-7 rounded-xl px-6">
                <Link href="/signup">
                  Protect my accounts <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              {SAFETY.map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-[#F7F2E8]/15 bg-[#F7F2E8]/[0.04] p-[18px]"
                >
                  <s.icon className="size-5 text-primary" />
                  <div className="mt-2.5 text-sm font-semibold">{s.label}</div>
                  <div className="mt-0.5 text-xs text-[#F7F2E8]/55">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------- WALL OF LOVE ------------------------------ */}
      <section className="border-t bg-card/50">
        <div className="mx-auto max-w-5xl px-6 py-[72px]">
          <div className="mx-auto max-w-xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              <Heart className="size-3.5 fill-current" /> Wall of love
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
              Teams that scaled outreach safely
            </h2>
          </div>
          <div className="mt-11 grid gap-[18px] lg:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure
                key={t.name}
                className="reveal surface-card flex flex-col p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-soft-lg"
              >
                <div className="text-[15px] tracking-[2px] text-primary">★★★★★</div>
                <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-foreground">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span
                    className={`flex size-[38px] items-center justify-center rounded-full text-[13px] font-bold text-white ${t.bg}`}
                  >
                    {t.initials}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-[18px] grid gap-[18px] sm:grid-cols-2">
            <RatingCard mark="G2" markClass="rounded-md bg-[#E1533B]" label="G2 reviews" score="4.9/5" />
            <RatingCard
              mark="P"
              markClass="rounded-full bg-[#DA552F]"
              label="Product Hunt"
              score="4.8/5"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------ PRICING TEASER ----------------------------- */}
      <section id="pricing" className="mx-auto max-w-2xl scroll-mt-24 px-6 py-20 text-center">
        <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          Simple pricing
        </span>
        <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
          Pay per sending account. Everything else is unlimited.
        </h2>
        <p className="mt-4 text-[17px] text-muted-foreground">
          From <span className="font-bold text-foreground">${PRICE_PER_SLOT.annual}</span> per
          sending account / month, billed annually.
        </p>
        <div className="mx-auto mt-8 grid max-w-xl gap-x-6 gap-y-2.5 text-left sm:grid-cols-2">
          {INCLUDED_FEATURES.map((f) => (
            <div key={f} className="flex items-start gap-2.5 text-[14.5px]">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
            </div>
          ))}
        </div>
        <Button asChild size="lg" className="mt-8 rounded-xl px-7">
          <Link href="/pricing">
            View full pricing <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      {/* ----------------------------------- FAQ ----------------------------------- */}
      <section className="mx-auto max-w-2xl px-6 pb-[72px] pt-6">
        <h2 className="text-center font-display text-[32px] font-semibold tracking-[-0.02em]">
          Frequently asked questions
        </h2>
        <div className="mt-9 flex flex-col gap-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group surface-card rounded-2xl px-5 py-[18px] [&_summary]:list-none"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-[15.5px] font-semibold">
                {item.q}
                <Plus className="size-[18px] shrink-0 text-primary transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* -------------------------------- FINAL CTA -------------------------------- */}
      <section className="px-6 pb-[72px] pt-6">
        <div className="reveal relative mx-auto max-w-4xl overflow-hidden rounded-[28px] bg-primary px-10 py-16 text-center text-white">
          <div className="pointer-events-none absolute -bottom-24 -left-16 size-[280px] rounded-full bg-white/10" />
          <div className="relative">
            <h2 className="mx-auto max-w-[620px] font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[42px]">
              Start conversations that turn into pipeline
            </h2>
            <p className="mx-auto mt-4 max-w-[520px] text-[17px] leading-relaxed text-white/85">
              Connect an account, build your first sequence, and let the safety engine handle the
              rest.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-foreground px-7 py-3.5 text-base font-semibold text-background transition-colors hover:bg-foreground/90"
              >
                Start free <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-xl border border-white/30 bg-white/[0.16] px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-white/25"
              >
                Log in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Product preview mocks — lightweight div-based, themed to match (no images). */
/* -------------------------------------------------------------------------- */

function HeroPreview() {
  return (
    <div className="float surface-card mt-12 overflow-hidden text-left shadow-soft-lg">
      <BrowserChrome url="app.10xconnect.com / campaigns / Q2 Founders" />
      <div className="grid md:grid-cols-[1fr_1.15fr]">
        <div className="border-b p-6 md:border-b-0 md:border-r">
          <PanelLabel>Sequence</PanelLabel>
          <div className="mt-4 flex flex-col gap-2.5">
            <SeqNode icon={ThumbsUp} label="Like last post" />
            <Connector />
            <SeqNode icon={UserPlus} label="Connection request" />
            <Connector />
            <SeqNode condition icon={GitBranch} label="Invite accepted?" />
            <Connector />
            <SeqNode icon={Mic} label="Voice note" />
          </div>
        </div>
        <div className="p-6">
          <PanelLabel>This workspace</PanelLabel>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatTile tint="bg-tint-coral" value="1,284" label="Connections" />
            <StatTile tint="bg-tint-blue" value="312" label="Replies" />
            <StatTile tint="bg-tint-green" value="41%" label="Accept rate" />
            <StatTile tint="bg-tint-violet" value="57" label="Booked" />
          </div>
          <div className="mt-3 rounded-2xl border p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[12.5px] font-semibold">Account health</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-bold text-success">
                <span className="ping-dot inline-block size-1.5 rounded-full bg-success" />
                Healthy · 86
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-full w-[86%] rounded-full bg-success" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockSequence() {
  return (
    <div className="surface-card p-6">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3 rounded-xl border bg-secondary/40 px-3.5 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <Play className="size-3.5 fill-current" />
          </span>
          <span className="text-sm font-semibold">Start the campaign</span>
        </div>
        <Connector />
        <div className="flex items-center gap-3 rounded-xl border bg-secondary/40 px-3.5 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserPlus className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Connection request</div>
            <div className="text-[11.5px] text-muted-foreground">No note · best acceptance</div>
          </div>
        </div>
        <Connector />
        <div className="flex items-center gap-3 rounded-xl border border-[#DED1FB] bg-[#F1ECFE] px-3.5 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-white text-[#743CE2]">
            <GitBranch className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[#5B3BA8]">Invite accepted?</div>
            <div className="text-[11.5px] text-[#9C84C8]">yes → continue · no → stop</div>
          </div>
        </div>
        <Connector />
        <div className="flex items-center gap-3 rounded-xl border bg-secondary/40 px-3.5 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageCircle className="size-4" />
          </span>
          <span className="text-sm font-semibold">Message · AI personalized</span>
        </div>
      </div>
    </div>
  );
}

function MockPersonalization() {
  return (
    <div className="surface-card p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-[42px] items-center justify-center rounded-full bg-[#3C66E2] font-bold text-white">
          AL
        </span>
        <div>
          <div className="text-sm font-semibold">Andi Lane</div>
          <div className="text-xs text-muted-foreground">VP Sales · Acme Corp</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
          <Sparkles className="size-3" /> AI
        </span>
      </div>
      <div className="mt-4 rounded-2xl border bg-secondary/40 p-4">
        <div className="text-[11px] font-semibold text-muted-foreground">Generated first line</div>
        <p className="mt-1.5 text-[14.5px] leading-relaxed">
          &ldquo;Loved your post on outbound attribution, Andi — curious how your team is handling
          multi-touch reporting these days?&rdquo;
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
          Observation
        </span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
          Soft question
        </span>
        <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11.5px] font-bold text-success">
          No pitch
        </span>
      </div>
    </div>
  );
}

function MockInbox() {
  const threads = [
    { initials: "PS", name: "Priya Shah", msg: "Sure, let's find a time…", bg: "bg-[#743CE2]", active: true },
    { initials: "DK", name: "Daniel Kim", msg: "What does pricing look like?", bg: "bg-[#3C66E2]", active: false },
    { initials: "SL", name: "Sara Lee", msg: "Thanks for connecting!", bg: "bg-success", active: false },
  ];
  return (
    <div className="surface-card grid grid-cols-[1fr_1.1fr] overflow-hidden">
      <div className="border-r">
        {threads.map((t) => (
          <div
            key={t.name}
            className={`flex items-center gap-2.5 border-b px-3.5 py-3 last:border-b-0 ${
              t.active ? "bg-primary/10" : ""
            }`}
          >
            <span
              className={`flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${t.bg}`}
            >
              {t.initials}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{t.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{t.msg}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col p-3.5">
        <span className="self-start rounded-full bg-success/12 px-2.5 py-0.5 text-[10.5px] font-bold text-success">
          Booked
        </span>
        <div className="mt-2.5 flex flex-col gap-1.5">
          <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs leading-snug text-primary-foreground">
            Would love to show you how we keep accounts safe — open to a quick call?
          </div>
          <div className="max-w-[82%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-xs leading-snug">
            Sure, let&apos;s find a time…
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2 rounded-xl border px-3 py-2.5 pt-3">
          <span className="flex-1 text-xs text-muted-foreground">Reply…</span>
          <Send className="size-3.5 text-primary" />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Primitives ------------------------------ */

function BrowserChrome({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b bg-secondary/50 px-4 py-3">
      <span className="size-[11px] rounded-full bg-[#E2A8A0]" />
      <span className="size-[11px] rounded-full bg-[#E8CF9A]" />
      <span className="size-[11px] rounded-full bg-[#A8CDB0]" />
      <span className="ml-3 text-xs text-muted-foreground">{url}</span>
    </div>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Connector() {
  return <div className="ml-3.5 h-2 w-0.5 bg-border" />;
}

function SeqNode({
  icon: Icon,
  label,
  condition = false,
}: {
  icon: LucideIcon;
  label: string;
  condition?: boolean;
}) {
  if (condition) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#DED1FB] bg-[#F1ECFE] px-3.5 py-3">
        <span className="flex size-[30px] items-center justify-center rounded-lg bg-white text-[#743CE2]">
          <Icon className="size-4" />
        </span>
        <span className="text-[13.5px] font-semibold text-[#5B3BA8]">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-secondary/40 px-3.5 py-3">
      <span className="flex size-[30px] items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="text-[13.5px] font-semibold">{label}</span>
    </div>
  );
}

function StatTile({ tint, value, label }: { tint: string; value: string; label: string }) {
  return (
    <div className={`rounded-2xl p-3.5 ${tint}`}>
      <div className="font-display text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-foreground/60">{label}</div>
    </div>
  );
}

function RatingCard({
  mark,
  markClass,
  label,
  score,
}: {
  mark: string;
  markClass: string;
  label: string;
  score: string;
}) {
  return (
    <div className="surface-card flex items-center justify-between px-6 py-5">
      <span className="flex items-center gap-2.5 text-[15px] font-semibold">
        <span
          className={`flex size-[26px] items-center justify-center text-[13px] font-extrabold text-white ${markClass}`}
        >
          {mark}
        </span>
        {label}
      </span>
      <span className="text-right">
        <span className="font-display text-[26px] font-bold">{score}</span>
        <span className="block text-[13px] tracking-[1px] text-primary">★★★★★</span>
      </span>
    </div>
  );
}

function PillarRow({
  eyebrow,
  title,
  body,
  bullets,
  mock,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  mock: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-14 lg:grid-cols-2">
      <div className={reverse ? "lg:order-2" : ""}>
        <span className="text-sm font-bold text-primary">{eyebrow}</span>
        <h2 className="mt-3 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
          {title}
        </h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">{body}</p>
        <ul className="mt-5 flex flex-col gap-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[15px]">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {b}
            </li>
          ))}
        </ul>
      </div>
      <div className={`reveal ${reverse ? "lg:order-1" : ""}`}>{mock}</div>
    </div>
  );
}
