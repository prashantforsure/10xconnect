"use client";

import { GitBranch, Layers, Zap } from "lucide-react";

import { useBuilder, type TemplateKind } from "./context";
import { iconForType } from "./node-icons";

import { Modal } from "@/components/ui/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Edge } from "@/lib/campaigns/graph";
import { ACTION_NODES, CONDITION_NODES, type NodeDef } from "@/lib/campaigns/nodes";

const TEMPLATES: { kind: TemplateKind; label: string; description: string }[] = [
  { kind: "connected_split", label: "Connected vs not connected", description: "branch: message if connected, else connect → message" },
  { kind: "nurture", label: "Engagement nurture", description: "like → wait → visit → wait → comment" },
  { kind: "revisit", label: "Revisit later", description: "long wait, then a fresh-angle message" },
];

/** A single node option in the card grid (tinted icon + label + description). */
function NodeCardButton({ def, onClick }: { def: NodeDef; onClick: () => void }) {
  const Icon = iconForType(def.type, def.kind);
  const tint = def.kind === "condition" ? "bg-chart-4/15 text-chart-4" : "bg-primary/15 text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.05]"
    >
      <span className={`inline-flex size-9 items-center justify-center rounded-[9px] ${tint}`}>
        <Icon className="size-[18px]" />
      </span>
      <span className="text-[13px] font-semibold text-foreground">{def.label}</span>
      <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{def.description}</span>
    </button>
  );
}

/**
 * The +Add-step picker. Replaces the old cramped dropdown scroller with a roomy
 * card grid in a modal: tabs for Add an action / Add a condition, plus Templates
 * (multi-step chains) as list rows. Renders inside the Modal portal, which
 * preserves React context so useBuilder() still resolves.
 */
export function InsertModal({ open, onClose, edge }: { open: boolean; onClose: () => void; edge: Edge }) {
  const { insertNode, insertTemplate } = useBuilder();
  const pick = (fn: () => void): void => {
    fn();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a step" className="max-w-2xl">
      <Tabs defaultValue="action">
        <TabsList>
          <TabsTrigger value="action">
            <Zap className="size-4" /> Add an action
          </TabsTrigger>
          <TabsTrigger value="condition">
            <GitBranch className="size-4" /> Add a condition
          </TabsTrigger>
          <TabsTrigger value="template">
            <Layers className="size-4" /> Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="action">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {ACTION_NODES.map((n) => (
              <NodeCardButton key={n.type} def={n} onClick={() => pick(() => insertNode(edge, "action", n.type))} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="condition">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {CONDITION_NODES.map((n) => (
              <NodeCardButton key={n.type} def={n} onClick={() => pick(() => insertNode(edge, "condition", n.type))} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="template">
          <div className="grid grid-cols-1 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.kind}
                type="button"
                onClick={() => pick(() => insertTemplate(edge, t.kind))}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.05]"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-chart-4/15 text-chart-4">
                  <Layers className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">{t.label}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </Modal>
  );
}
