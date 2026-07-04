"use client";

import {
  AudioLines,
  CreditCard,
  KeyRound,
  Palette,
  Plug,
  Settings2,
  ShieldCheck,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const settingsNav: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/settings/general", label: "General", icon: Settings2 },
  { href: "/settings/accounts", label: "Accounts & safety", icon: ShieldCheck },
  { href: "/settings/members", label: "Members", icon: Users },
  { href: "/settings/billing", label: "Billing", icon: CreditCard },
  { href: "/settings/voice-cloner", label: "Voice Cloner", icon: AudioLines },
  { href: "/settings/white-label", label: "White Label", icon: Palette },
  { href: "/settings/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/settings/api", label: "API", icon: KeyRound },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full">
      {/* Quiet left nav (desktop) */}
      <aside className="hidden w-[210px] shrink-0 border-r border-border bg-card/40 p-4 md:block">
        <h2 className="mb-3 px-3 text-sm font-semibold tracking-tight">Settings</h2>
        <nav className="space-y-0.5">
          {settingsNav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-[9px] rounded-md px-2.5 py-[7px] text-[12.5px] font-medium transition-colors",
                  active
                    ? "bg-white/[0.07] text-foreground"
                    : "text-white/60 hover:bg-white/[0.05] hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-white/60",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile horizontal nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card/40 px-4 py-2 md:hidden">
          {settingsNav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-white/[0.07] text-foreground"
                    : "text-white/60 hover:bg-white/[0.05] hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </div>
  );
}
