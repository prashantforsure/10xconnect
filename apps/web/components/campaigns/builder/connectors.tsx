"use client";

import { Clock, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { useBuilder } from "./context";
import { InsertModal } from "./insert-modal";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Edge, GraphNode } from "@/lib/campaigns/graph";

const Line = ({ className = "h-3" }: { className?: string }) => (
  <div className={`w-px bg-border ${className}`} />
);

/** A circular "+" on the connector that opens the Add action/condition/template modal. */
export function InsertButton({ edge }: { edge: Edge }) {
  const { running } = useBuilder();
  const [open, setOpen] = useState(false);
  if (running) {
    return <Line className="h-6" />;
  }
  return (
    <div className="flex flex-col items-center">
      <Line />
      <button
        type="button"
        aria-label="Insert step"
        onClick={() => setOpen(true)}
        className="flex size-6 items-center justify-center rounded-full border border-input bg-card text-primary shadow-soft transition-colors hover:border-primary hover:bg-primary/10"
      >
        <Plus className="size-3.5" />
      </button>
      <InsertModal open={open} onClose={() => setOpen(false)} edge={edge} />
      <Line />
    </div>
  );
}

/** A compact "847 leads · 98% enriched" pill on the connector. */
export function StatChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <Line className="h-2" />
      <span className="rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-soft">
        {children}
      </span>
    </div>
  );
}

/** Green-highlighted figure inside a stat chip. */
export function Stat({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-success">{children}</span>;
}

/**
 * A wait_x_days step rendered as a clock pill on the connector. The duration is
 * a content edit and stays editable while the campaign runs; removing the wait
 * is structural, so that item is hidden until the campaign is stopped.
 */
export function DelayPill({ node }: { node: GraphNode }) {
  const { running, updateConfig, remove } = useBuilder();
  const days = Number(node.config.days) || 1;
  const label = `${days} ${days === 1 ? "day" : "days"}`;
  return (
    <div className="flex flex-col items-center">
      <Line className="h-2" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-soft transition-colors hover:border-primary hover:text-foreground"
          >
            <Clock className="size-3" /> {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Wait duration</DropdownMenuLabel>
          <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={90}
                value={days}
                onChange={(e) => updateConfig(node.id, "days", Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
                className="h-8 w-20 text-xs"
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </div>
          {!running ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => remove(node.id)}>
                <Trash2 className="size-3.5" /> Remove wait
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Line className="h-2" />
    </div>
  );
}

/** Branch label pill at the top of a fork column (true = active wash, false = muted). */
export function BranchLabel({ text, active }: { text: string; active: boolean }) {
  return (
    <span
      className={
        "rounded-full px-3 py-1 text-xs font-bold " +
        (active ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")
      }
    >
      {text}
    </span>
  );
}

/** Terminal "× End of sequence" chip for a branch that ends. */
export function EndChip() {
  return (
    <div className="flex flex-col items-center">
      <Line className="h-2" />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-input bg-background/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
        <X className="size-3" /> End of sequence
      </span>
    </div>
  );
}
