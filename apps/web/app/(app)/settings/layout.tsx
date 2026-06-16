"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const settingsNav = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/accounts", label: "Accounts" },
  { href: "/settings/members", label: "Members" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/voice-cloner", label: "Voice Cloner" },
  { href: "/settings/white-label", label: "White Label" },
  { href: "/settings/webhooks", label: "Webhooks" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/api", label: "API" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full">
      <div className="w-52 shrink-0 border-r p-4">
        <h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Settings
        </h2>
        <nav className="space-y-1">
          {settingsNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-2 py-1.5 text-sm transition-colors",
                pathname === item.href
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
