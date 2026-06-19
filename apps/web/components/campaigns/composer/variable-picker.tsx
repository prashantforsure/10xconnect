"use client";

import { type VariableDef, VARIABLE_REGISTRY } from "@10xconnect/core";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Searchable contact-variable inserter. Picking a variable prompts for an optional
 * FALLBACK (CLAUDE.md §7 — empty + no fallback ⇒ the segment is skipped, never a
 * broken merge). No command-palette dependency; a small self-contained popover.
 */
export function VariablePicker({
  onInsert,
  disabled,
}: {
  onInsert: (key: string, fallback?: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<VariableDef | null>(null);
  const [fallback, setFallback] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const reset = (): void => {
    setOpen(false);
    setQuery("");
    setPending(null);
    setFallback("");
  };

  const confirm = (def: VariableDef, fb: string): void => {
    onInsert(def.key, fb.trim() || undefined);
    reset();
  };

  const filtered = VARIABLE_REGISTRY.filter((v) =>
    v.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="size-4" />
        Contact Variables
      </Button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border bg-popover p-2 text-popover-foreground shadow-soft-md">
          {pending ? (
            <div className="space-y-2">
              <p className="px-1 text-xs font-medium text-muted-foreground">
                Insert <span className="text-foreground">{pending.label}</span>
              </p>
              <Input
                autoFocus
                value={fallback}
                onChange={(e) => setFallback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirm(pending, fallback);
                  }
                }}
                placeholder="Fallback if empty (optional)"
              />
              <p className="px-1 text-[11px] text-muted-foreground">
                Leave blank to skip this part when the value is missing — no broken messages.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPending(null)}>
                  Back
                </Button>
                <Button type="button" size="sm" onClick={() => confirm(pending, fallback)}>
                  Insert
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search variables…"
                className="mb-2 h-9"
              />
              <div className="max-h-60 overflow-auto">
                {filtered.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>
                ) : (
                  filtered.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => {
                        setPending(v);
                        setFallback("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                      )}
                    >
                      <span>{v.label}</span>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {v.group}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
