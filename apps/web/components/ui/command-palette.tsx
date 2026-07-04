"use client";

import {
  Inbox,
  LayoutDashboard,
  Megaphone,
  Plug,
  Plus,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type PaletteKind = "nav" | "action";

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  group: string;
  kind: PaletteKind;
  icon: LucideIcon;
  kbd?: string;
  run: (router: ReturnType<typeof useRouter>) => void;
}

const ITEMS: PaletteItem[] = [
  // Navigation
  {
    id: "nav-dashboard",
    label: "Go to Dashboard",
    hint: "Overview & next actions",
    group: "Navigation",
    kind: "nav",
    icon: LayoutDashboard,
    kbd: "G D",
    run: (r) => r.push("/dashboard"),
  },
  {
    id: "nav-campaigns",
    label: "Go to Campaigns",
    hint: "All sequences",
    group: "Navigation",
    kind: "nav",
    icon: Megaphone,
    kbd: "G C",
    run: (r) => r.push("/campaigns"),
  },
  {
    id: "nav-contacts",
    label: "Go to Contacts",
    hint: "Leads & enrichment",
    group: "Navigation",
    kind: "nav",
    icon: Users,
    run: (r) => r.push("/contacts"),
  },
  {
    id: "nav-inbox",
    label: "Go to Inbox",
    hint: "Replies waiting",
    group: "Navigation",
    kind: "nav",
    icon: Inbox,
    kbd: "G I",
    run: (r) => r.push("/inbox"),
  },
  {
    id: "nav-settings",
    label: "Go to Settings",
    hint: "Accounts & safety",
    group: "Navigation",
    kind: "nav",
    icon: Settings,
    run: (r) => r.push("/settings/general"),
  },
  // Quick actions
  {
    id: "action-new-campaign",
    label: "New campaign",
    hint: "Create a sequence",
    group: "Quick actions",
    kind: "action",
    icon: Plus,
    run: (r) => r.push("/campaigns"),
  },
  {
    id: "action-go-inbox",
    label: "Go to Inbox",
    hint: "Manage replies",
    group: "Quick actions",
    kind: "action",
    icon: Inbox,
    run: (r) => r.push("/inbox"),
  },
  {
    id: "action-connect-account",
    label: "Connect account",
    hint: "Settings · Accounts",
    group: "Quick actions",
    kind: "action",
    icon: Plug,
    run: (r) => r.push("/settings/accounts"),
  },
];

/**
 * Global ⌘K / Ctrl+K command palette. Self-contained: it owns its open state and
 * key listener, so AppShell only has to render it once. Navigation uses Next's
 * router. Matches the Command Dark overlay look (bg-popover, raised border,
 * shadow-overlay).
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K toggles; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActive(0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Topbar trigger and any other caller can open via a custom event.
  useEffect(() => {
    const onOpen = (): void => {
      setOpen(true);
      setQuery("");
      setActive(0);
    };
    window.addEventListener("command-palette:open", onOpen);
    return () => window.removeEventListener("command-palette:open", onOpen);
  }, []);

  // Focus the input when the palette opens.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return ITEMS;
    }
    return ITEMS.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q));
  }, [query]);

  // Keep the active index within bounds as the list shrinks/grows.
  useEffect(() => {
    setActive((a) => (a >= filtered.length ? 0 : a));
  }, [filtered.length]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { item: PaletteItem; index: number }[]>();
    filtered.forEach((item, index) => {
      if (!map.has(item.group)) {
        map.set(item.group, []);
        order.push(item.group);
      }
      map.get(item.group)!.push({ item, index });
    });
    return order.map((g) => ({ group: g, rows: map.get(g)! }));
  }, [filtered]);

  const runItem = (item: PaletteItem): void => {
    setOpen(false);
    item.run(router);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (filtered.length === 0 ? 0 : (a + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (filtered.length === 0 ? 0 : (a - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item) {
        runItem(item);
      }
    }
  };

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[13vh] backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-white/10 bg-elevated text-popover-foreground shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-[18px] py-[15px]">
          <Search className="size-[17px] shrink-0 text-white/40" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search or run a command…"
            className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="rounded-[5px] bg-background px-1.5 py-1 font-mono text-[10px] font-semibold text-muted-foreground">
            ESC
          </span>
        </div>
        <div className="max-h-[340px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-6 py-6 text-center text-sm text-muted-foreground">No matches</div>
          ) : (
            groups.map(({ group, rows }) => (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </p>
                {rows.map(({ item, index }) => {
                  const Icon = item.icon;
                  const isActive = index === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => runItem(item)}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[9px] px-3 py-[11px] text-left transition-colors",
                        isActive ? "bg-accent" : "bg-transparent",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-[30px] shrink-0 items-center justify-center rounded-lg",
                          item.kind === "action"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="size-[15px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-foreground">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {item.hint}
                        </span>
                      </span>
                      {item.kbd ? (
                        <span className="font-mono text-[10px] font-semibold text-muted-foreground/60">
                          {item.kbd}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
