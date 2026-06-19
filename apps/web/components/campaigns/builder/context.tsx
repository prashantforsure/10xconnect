"use client";

import { createContext, useContext } from "react";

import { type Edge, type GraphNode, rootId } from "@/lib/campaigns/graph";

export interface NodeStat {
  leads: number;
  done: number;
  failed: number;
}

export interface NodeStatsResponse {
  summary: { leads: number; enrichedPct: number };
  nodes: Record<string, NodeStat>;
}

export type TemplateKind = "nurture" | "revisit" | "connected_split";

/** Everything the recursive canvas needs, shared via context (no prop drilling). */
export interface BuilderContextValue {
  running: boolean;
  nodeMap: Map<string, GraphNode>;
  root: string | null;
  counts: Record<string, number>;
  stats: NodeStatsResponse | null;
  selectedId: string | null;
  insertNode: (edge: Edge, kind: "action" | "condition", type: string) => void;
  insertTemplate: (edge: Edge, which: TemplateKind) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  updateConfig: (id: string, key: string, value: unknown) => void;
  selectComposer: (id: string) => void;
}

const BuilderContext = createContext<BuilderContextValue | null>(null);

export function BuilderProvider({
  value,
  children,
}: {
  value: BuilderContextValue;
  children: React.ReactNode;
}) {
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder(): BuilderContextValue {
  const ctx = useContext(BuilderContext);
  if (!ctx) {
    throw new Error("useBuilder must be used within a BuilderProvider");
  }
  return ctx;
}

/** Resolve the node currently attached at an edge (or the root for a root edge). */
export function childIdAt(ctx: BuilderContextValue, edge: Edge): string | null {
  if (edge.parentId === null) {
    return ctx.root;
  }
  return ctx.nodeMap.get(edge.parentId)?.[edge.slot] ?? null;
}

export { rootId };
