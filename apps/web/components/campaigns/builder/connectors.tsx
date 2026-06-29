"use client";

import { Clock, GitBranch, Layers, Plus, Trash2, X, Zap } from "lucide-react";

import { useBuilder } from "./context";

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
import { ACTION_NODES, CONDITION_NODES } from "@/lib/campaigns/nodes";

const TEMPLATES: { kind: "nurture" | "revisit" | "connected_split"; label: string; description: string }[] = [
  { kind: "connected_split", label: "Connected vs not connected", description: "branch: message if connected, else connect → message" },
  { kind: "nurture", label: "Engagement nurture", description: "like → wait → visit → wait → comment" },
  { kind: "revisit", label: "Revisit later", description: "long wait, then a fresh-angle message" },
];

const Line = ({ className = "h-3" }: { className?: string }) => (
  <div className={`w-px bg-border ${className}`} />
);

/** A circular "+" on the connector that opens the Add action/condition/template menu. */
export function InsertButton({ edge }: { edge: Edge }) {
  const { running, insertNode, insertTemplate } = useBuilder();
  if (running) {
    return <Line className="h-6" />;
  }
  return (
    <div className="flex flex-col items-center">
      <Line />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Insert step"
            className="flex size-6 items-center justify-center rounded-full border border-input bg-card text-primary shadow-soft transition-colors hover:border-primary hover:bg-primary/10"
          >
            <Plus className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[22rem] w-64 overflow-auto">
          <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Zap className="size-3.5" /> Actions
          </DropdownMenuLabel>
          {ACTION_NODES.map((n) => (
            <DropdownMenuItem key={n.type} onSelect={() => insertNode(edge, "action", n.type)} className="flex-col items-start">
              <span className="text-sm font-medium">{n.label}</span>
              <span className="text-[11px] text-muted-foreground">{n.description}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitBranch className="size-3.5" /> Conditions
          </DropdownMenuLabel>
          {CONDITION_NODES.map((n) => (
            <DropdownMenuItem key={n.type} onSelect={() => insertNode(edge, "condition", n.type)} className="flex-col items-start">
              <span className="text-sm font-medium">{n.label}</span>
              <span className="text-[11px] text-muted-foreground">{n.description}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="size-3.5" /> Templates
          </DropdownMenuLabel>
          {TEMPLATES.map((t) => (
            <DropdownMenuItem key={t.kind} onSelect={() => insertTemplate(edge, t.kind)} className="flex-col items-start">
              <span className="text-sm font-medium">{t.label}</span>
              <span className="text-[11px] text-muted-foreground">{t.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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

/** A wait_x_days step rendered as a clock pill on the connector (editable + deletable). */
export function DelayPill({ node }: { node: GraphNode }) {
  const { running, updateConfig, remove } = useBuilder();
  const days = Number(node.config.days) || 1;
  const label = `${days} ${days === 1 ? "day" : "days"}`;
  if (running) {
    return (
      <div className="flex flex-col items-center">
        <Line className="h-2" />
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-soft">
          <Clock className="size-3" /> {label}
        </span>
        <Line className="h-2" />
      </div>
    );
  }
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
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => remove(node.id)}>
            <Trash2 className="size-3.5" /> Remove wait
          </DropdownMenuItem>
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
