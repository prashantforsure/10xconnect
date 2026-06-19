"use client";

import {
  BookOpen,
  Code,
  DollarSign,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/utils";

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

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (item: NavItem): boolean => {
    const base = item.match ?? item.href;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <div className="app-surface flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <SidebarContent isActive={isActive} userEmail={userEmail} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 animate-fade-in flex-col border-r bg-card shadow-soft-lg">
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

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <PanelLeftClose className="size-5" />
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground">Workspace</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="font-semibold text-foreground">{sectionLabel(pathname)}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href="/tutorials">Help</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/campaigns">
                <Plus className="size-4" /> New campaign
              </Link>
            </Button>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
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
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-primary font-display text-xs font-bold tracking-tight text-primary-foreground shadow-soft">
          10×
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">10xConnect</span>
      </div>
      <div className="px-3 pb-2">
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        {navSections.map((section, i) => (
          <div key={section.title ?? i} className="space-y-1">
            {section.title ? (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item)} />
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t p-3">
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
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className={cn("size-[18px] transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      {item.label}
    </Link>
  );
}
