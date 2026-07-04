"use client";

import {
  BookOpen,
  Building2,
  Code,
  DollarSign,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { SimulationBanner } from "@/components/simulation-banner";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/ui/command-palette";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/utils";

/** Open the global ⌘K command palette from anywhere (topbar trigger). */
function openCommandPalette(): void {
  window.dispatchEvent(new Event("command-palette:open"));
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/accounts", label: "Accounts", icon: ShieldCheck, match: "/accounts" },
      { href: "/agency", label: "Agency", icon: Building2, match: "/agency" },
    ],
  },
  {
    title: "Workspace",
    items: [{ href: "/settings/general", label: "Settings", icon: Settings, match: "/settings" }],
  },
  {
    title: "Resources",
    items: [
      { href: "/tutorials", label: "Tutorials", icon: BookOpen },
      { href: "/affiliate", label: "Affiliate", icon: DollarSign },
      { href: "/settings/api", label: "API", icon: Code },
      { href: "/community", label: "Community", icon: MessagesSquare },
    ],
  },
];

const SECTION_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/dashboard", label: "Dashboard" },
  { prefix: "/campaigns", label: "Campaigns" },
  { prefix: "/contacts", label: "Contacts" },
  { prefix: "/inbox", label: "Inbox" },
  { prefix: "/accounts", label: "Accounts" },
  { prefix: "/agency", label: "Agency" },
  { prefix: "/settings", label: "Settings" },
  { prefix: "/affiliate", label: "Affiliate" },
  { prefix: "/tutorials", label: "Tutorials" },
  { prefix: "/community", label: "Community" },
  { prefix: "/onboarding", label: "Get started" },
];

function sectionLabel(pathname: string): string {
  return SECTION_LABELS.find((s) => pathname.startsWith(s.prefix))?.label ?? "Workspace";
}

export function AppShell({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply the Command Dark in-app theme to <html> so PORTALED overlays
  // (Radix dropdown/select/tooltip, custom modals, slide-overs) that render at
  // document.body — and therefore escape the in-page `.app-surface` div below —
  // still inherit the dark CSS variables. Removed on unmount so marketing/auth
  // shells keep the warm cream :root theme.
  useEffect(() => {
    document.documentElement.classList.add("app-surface");
    return () => {
      document.documentElement.classList.remove("app-surface");
    };
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (item: NavItem): boolean => {
    const base = item.match ?? item.href;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <div className="app-surface flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — 248px, sits just off the canvas. */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-[hsl(45_22%_5.5%)] lg:flex">
        <SidebarContent isActive={isActive} userEmail={userEmail} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside className="absolute left-0 top-0 flex h-full w-[248px] animate-fade-in flex-col border-r border-border bg-[hsl(45_22%_5.5%)] shadow-overlay">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <SidebarContent isActive={isActive} userEmail={userEmail} />
          </aside>
        </div>
      ) : null}

      {/* Main column — a bounded flex column (the root is a fixed-height, non-scrolling
          viewport). The header + optional simulation banner are fixed chrome; only
          <main> scrolls. This lets full-height pages (inbox, campaign builder) use
          `h-full` and fill exactly the space left after the banner — no window scroll. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-7">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <PanelLeftClose className="size-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">Workspace</span>
            <span className="hidden text-muted-foreground/50 sm:inline">/</span>
            <span className="truncate font-semibold text-foreground">{sectionLabel(pathname)}</span>
          </div>
          {/* Quiet search / ⌘K trigger. */}
          <button
            type="button"
            onClick={openCommandPalette}
            className="ml-auto flex w-[300px] min-w-[44px] max-w-[34vw] shrink items-center gap-2.5 rounded-[10px] border border-input bg-[hsl(45_22%_5.5%)] px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Search className="size-[15px] shrink-0" />
            <span className="hidden truncate sm:inline">Search or run a command…</span>
            <span className="ml-auto hidden rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10px] font-semibold text-muted-foreground sm:inline">
              ⌘K
            </span>
          </button>
          <Button asChild size="sm" className="shadow-[0_0_18px_-5px_hsl(var(--primary)/0.6)]">
            <Link href="/campaigns">
              <Plus className="size-4" /> <span className="hidden sm:inline">New campaign</span>
            </Link>
          </Button>
        </header>
        <SimulationBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Global ⌘K command palette — mounted once, available app-wide. */}
      <CommandPalette />
    </div>
  );
}

function SidebarContent({
  isActive,
  userEmail,
}: {
  isActive: (item: NavItem) => boolean;
  userEmail: string;
}) {
  return (
    <>
      <div className="flex h-[60px] items-center gap-2.5 border-b border-border px-[18px]">
        <span className="flex size-[30px] items-center justify-center rounded-lg bg-primary font-display text-xs font-bold tracking-tight text-primary-foreground shadow-[0_0_16px_-2px_hsl(var(--primary)/0.55)]">
          10×
        </span>
        <span className="font-display text-base font-semibold tracking-tight">10xConnect</span>
      </div>
      <div className="px-3 pb-2 pt-3.5">
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-3 pt-1.5">
        {navSections.map((section, i) => (
          <div key={section.title ?? i} className="space-y-0.5">
            {section.title ? (
              <p className="px-[11px] pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/60">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item)} />
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <UserMenu email={userEmail} />
      </div>
    </>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-[11px] rounded-[10px] px-[11px] py-[9px] text-[13px] font-semibold transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {item.label}
    </Link>
  );
}
