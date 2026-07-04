"use client";

import {
  BookOpen,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Code,
  DollarSign,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  PanelLeft,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { SimulationBanner } from "@/components/simulation-banner";
import { CommandPalette } from "@/components/ui/command-palette";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "10x.sidebarCollapsed";

/** Open the global ⌘K command palette from anywhere (topbar trigger). */
function openCommandPalette(): void {
  window.dispatchEvent(new Event("command-palette:open"));
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string;
  badge?: string;
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
      { href: "/developers", label: "Developers", icon: Terminal },
      { href: "/affiliate", label: "Affiliate", icon: DollarSign },
      { href: "/settings/api", label: "API", icon: Code, match: "/settings/api" },
      { href: "/community", label: "Community", icon: MessagesSquare },
    ],
  },
];

// Breadcrumb map — most-specific prefixes first.
const CRUMBS: { prefix: string; group: string; page: string }[] = [
  { prefix: "/campaigns/", group: "Campaigns", page: "Campaign" },
  { prefix: "/campaigns", group: "Workspace", page: "Campaigns" },
  { prefix: "/dashboard", group: "Workspace", page: "Dashboard" },
  { prefix: "/contacts", group: "Workspace", page: "Contacts" },
  { prefix: "/inbox", group: "Workspace", page: "Inbox" },
  { prefix: "/accounts", group: "Workspace", page: "Accounts" },
  { prefix: "/agency", group: "Workspace", page: "Agency" },
  { prefix: "/settings/api", group: "Resources", page: "API" },
  { prefix: "/settings", group: "Workspace", page: "Settings" },
  { prefix: "/tutorials", group: "Resources", page: "Tutorials" },
  { prefix: "/developers", group: "Resources", page: "Developers" },
  { prefix: "/affiliate", group: "Resources", page: "Affiliate" },
  { prefix: "/community", group: "Resources", page: "Community" },
  { prefix: "/onboarding", group: "Workspace", page: "Get started" },
];

function crumb(pathname: string): { group: string; page: string } {
  return CRUMBS.find((c) => pathname.startsWith(c.prefix)) ?? { group: "Workspace", page: "" };
}

export function AppShell({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Apply the cool-dark theme to <html> so PORTALED overlays (Radix menus,
  // custom modals, slide-overs) that render at document.body inherit the tokens.
  useEffect(() => {
    document.documentElement.classList.add("app-surface");
    return () => {
      document.documentElement.classList.remove("app-surface");
    };
  }, []);

  // Hydrate the persisted collapse flag after mount (avoids SSR mismatch).
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  };

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (item: NavItem): boolean => {
    const base = item.match ?? item.href;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  const { group, page } = crumb(pathname);

  return (
    <div className="app-surface flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — 224px expanded / 60px collapsed icon rail. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-rail transition-[width] [transition-duration:160ms] ease-out lg:flex",
          collapsed ? "w-[60px]" : "w-[224px]",
        )}
      >
        <SidebarContent
          isActive={isActive}
          userEmail={userEmail}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside className="absolute left-0 top-0 flex h-full w-[224px] animate-fade-in flex-col border-r border-border bg-rail shadow-overlay">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1 text-white/45 hover:bg-white/[0.06] hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <SidebarContent isActive={isActive} userEmail={userEmail} collapsed={false} />
          </aside>
        </div>
      ) : null}

      {/* Main column — bounded flex column; only <main> scrolls. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-white/45 hover:bg-white/[0.06] hover:text-foreground lg:hidden"
          >
            <PanelLeft className="size-[18px]" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="hidden text-white/45 sm:inline">{group}</span>
            {page ? (
              <>
                <span className="hidden text-white/25 sm:inline">/</span>
                <span className="truncate font-semibold text-foreground">{page}</span>
              </>
            ) : null}
          </div>
          {/* Quiet ⌘K search trigger. */}
          <button
            type="button"
            onClick={openCommandPalette}
            className="ml-auto flex w-[260px] min-w-[44px] max-w-[34vw] shrink items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-white/40 transition-colors hover:text-white/60"
          >
            <Search className="size-[14px] shrink-0" />
            <span className="hidden truncate sm:inline">Search or run a command…</span>
            <span className="ml-auto hidden rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] font-semibold text-white/50 sm:inline">
              ⌘K
            </span>
          </button>
          <Link
            href="/campaigns"
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-primary/90"
          >
            <Plus className="size-[14px]" /> <span className="hidden sm:inline">New campaign</span>
          </Link>
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
  collapsed,
  onToggle,
}: {
  isActive: (item: NavItem) => boolean;
  userEmail: string;
  collapsed: boolean;
  onToggle?: () => void;
}) {
  return (
    <>
      {/* Logo + collapse toggle */}
      <div
        className={cn(
          "flex items-center gap-2.5 px-4 pb-2.5 pt-4",
          collapsed && "flex-col gap-2 px-0",
        )}
      >
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold tracking-[-0.02em] text-white">
          10×
        </span>
        {!collapsed ? (
          <span className="text-[13.5px] font-semibold">10xConnect</span>
        ) : null}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70",
              !collapsed && "ml-auto",
            )}
          >
            {collapsed ? <ChevronsRight className="size-[15px]" /> : <ChevronsLeft className="size-[15px]" />}
          </button>
        ) : null}
      </div>

      {/* Workspace switcher */}
      <div className={cn("pb-2.5", collapsed ? "px-0" : "px-3")}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className={cn("nsb flex-1 overflow-y-auto pb-3", collapsed ? "px-2" : "px-3")}>
        {navSections.map((section, i) => (
          <div key={section.title ?? i} className="flex flex-col gap-px">
            {section.title && !collapsed ? (
              <p className="px-2.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/35">
                {section.title}
              </p>
            ) : section.title && collapsed ? (
              <div className="my-2 h-px bg-white/[0.06]" />
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item)} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className={cn("border-t border-border p-3", collapsed && "px-0")}>
        <UserMenu email={userEmail} collapsed={collapsed} />
      </div>
    </>
  );
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        collapsed && "justify-center px-0",
        active ? "bg-white/[0.07] text-foreground" : "text-white/60 hover:bg-white/[0.05] hover:text-white/90",
      )}
    >
      <Icon className="size-[15px] shrink-0" />
      {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
      {item.badge && !collapsed ? (
        <span className="ml-auto rounded-full bg-primary/[0.18] px-1.5 py-px text-[11px] font-semibold text-indigo-text">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}
