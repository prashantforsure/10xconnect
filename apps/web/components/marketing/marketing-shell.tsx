import { ArrowRight, Headphones, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#safety", label: "Safety" },
  { href: "/#how", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Sequences" },
      { href: "/#features", label: "AI personalization" },
      { href: "/#features", label: "Unified inbox" },
      { href: "/#safety", label: "Safety engine" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/#", label: "About" },
      { href: "/#", label: "Blog" },
      { href: "/#", label: "Careers" },
      { href: "/affiliate", label: "Affiliates" },
      { href: "/#", label: "Contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/developers", label: "Developer docs" },
      { href: "/tutorials", label: "Tutorials" },
      { href: "/community", label: "Help center" },
      { href: "/community", label: "Community" },
      { href: "/#", label: "Status" },
    ],
  },
];

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "SOC 2 Type II" },
  { icon: Lock, label: "256-bit encryption" },
  { icon: Headphones, label: "24/5 support" },
];

function LogoMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-8 text-[13px]" : "size-[30px] text-xs";
  return (
    <span
      className={`flex ${box} items-center justify-center rounded-[9px] bg-primary font-display font-bold tracking-tight text-primary-foreground`}
    >
      10×
    </span>
  );
}

function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <LogoMark />
      <span
        className={`font-display text-lg font-bold tracking-tight ${dark ? "text-foreground" : ""}`}
      >
        10xConnect
      </span>
    </Link>
  );
}

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Announcement bar */}
      <div className="bg-card border-b border-border px-4 py-2.5 text-center text-[13px] font-medium text-foreground">
        <span className="inline-flex items-center gap-1.5 align-middle">
          <span className="ping-dot inline-block size-[7px] rounded-full bg-primary" />
          <span className="font-bold text-primary">New</span>
        </span>{" "}
        · Native LinkedIn voice notes at scale —{" "}
        <Link href="/signup" className="underline underline-offset-2">
          see it in action →
        </Link>
      </div>

      {/* Floating pill nav */}
      <header className="sticky top-0 z-50 bg-background/80 px-4 py-3.5 backdrop-blur-md sm:px-6">
        <nav className="mx-auto flex max-w-6xl items-center gap-4 rounded-2xl border border-border bg-card px-3 py-2.5 pl-4 shadow-raised sm:gap-5">
          <Wordmark />
          <div className="ml-2 hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className="hidden px-3.5 py-2 text-sm font-semibold transition-colors hover:text-primary sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Start free <ArrowRight className="size-4" />
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/* Dark footer */}
      <footer className="bg-rail text-muted-foreground">
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-14">
          <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(3,1fr)]">
            <div className="max-w-xs">
              <Wordmark dark />
              <p className="mt-4 text-sm leading-relaxed text-white/40">
                Safety-first LinkedIn &amp; email outreach. Start more conversations without burning
                your accounts.
              </p>
            </div>
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h4 className="mb-3.5 text-xs font-bold uppercase tracking-wider text-white/40">
                  {col.title}
                </h4>
                <ul className="flex flex-col gap-2.5 text-sm">
                  {col.links.map((l, i) => (
                    <li key={`${l.label}-${i}`}>
                      <Link href={l.href} className="transition-colors hover:text-foreground">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-11 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
            <div className="flex flex-wrap gap-2.5">
              {TRUST_BADGES.map((b) => (
                <span
                  key={b.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/45"
                >
                  <b.icon className="size-3.5" /> {b.label}
                </span>
              ))}
            </div>
            <div className="text-center text-xs text-white/40 sm:text-right">
              © {new Date().getFullYear()} 10xConnect, Inc. ·{" "}
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>{" "}
              ·{" "}
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
            </div>
          </div>
          <p className="mt-5 text-center text-[11px] leading-relaxed text-white/35 sm:text-left">
            LinkedIn automation carries risk and may violate LinkedIn&apos;s Terms — we never
            guarantee un-bannability.
          </p>
        </div>
      </footer>
    </div>
  );
}
