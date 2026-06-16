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
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string;
}

const mainNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/settings/general", label: "Settings", icon: Settings, match: "/settings" },
];

const bottomNav: NavItem[] = [
  { href: "/tutorials", label: "Tutorials", icon: BookOpen },
  { href: "/affiliate", label: "Affiliate", icon: DollarSign },
  { href: "/settings/api", label: "API", icon: Code },
  { href: "/community", label: "Community", icon: MessagesSquare },
];

export function AppShell({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const pathname = usePathname();

  const isActive = (item: NavItem): boolean => {
    const base = item.match ?? item.href;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex h-14 items-center px-4 text-lg font-semibold tracking-tight">
          10xConnect
        </div>
        <div className="px-3 pb-2">
          <WorkspaceSwitcher />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {mainNav.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </nav>
        <nav className="space-y-1 border-t px-3 py-2">
          {bottomNav.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </nav>
        <div className="border-t p-3">
          <UserMenu email={userEmail} />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}
