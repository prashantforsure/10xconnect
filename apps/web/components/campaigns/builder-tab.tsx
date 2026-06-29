"use client";

import { type GenNode } from "@10xconnect/core";
import { Wand2, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BuildWithAiModal } from "./build-with-ai";
import { SequenceCanvas } from "./builder/canvas";
import { type BuilderContextValue, BuilderProvider, type NodeStatsResponse } from "./builder/context";
import { ComposerPanel } from "./composer/composer-panel";
import type { PreviewSample } from "./composer/preview-modal";
import type { SenderAccount } from "./composer/sender-select";
import { WorkflowsPicker } from "./workflows-picker";

import { Button } from "@/components/ui/button";
import { SlideOver } from "@/components/ui/slide-over";
import { nodeLabel } from "@/lib/campaigns/nodes";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { configForTypeChange, defaultConfigFor, isComposerType } from "@/lib/campaigns/composer";
import {
  byId,
  createNode,
  type Edge,
  type GraphNode,
  insertChainAtEdge,
  insertNodeAtEdge,
  linearChain,
  moveNode,
  removeNode as removeNodeFromGraph,
  rootId,
  setNodeConfig,
  changeNodeType,
  toSavePayload,
} from "@/lib/campaigns/graph";
import { buildTemplate, type TemplateKind } from "@/lib/campaigns/templates";
import { createDebouncer, type Debouncer } from "@/lib/util/debounce";
import { useWorkspace } from "@/lib/workspace/context";

const AUTOSAVE_DEBOUNCE_MS = 1200;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

// Demo preview leads when the campaign has none yet (second lead has empty
// Biography/Company Overview to demonstrate fallback + skip-on-empty).
const DEMO_SAMPLES: PreviewSample[] = [
  {
    leadId: "demo-1",
    name: "Jordan Lee",
    vars: {
      first_name: "Jordan",
      last_name: "Lee",
      headline: "Head of Growth at Northwind",
      role: "Head of Growth",
      about: "Scaling B2B SaaS go-to-market",
      location: "Austin, TX",
      company: "Northwind",
      company_overview: "B2B analytics platform for ops teams",
    },
  },
  {
    leadId: "demo-2",
    name: "Sam Rivera",
    vars: {
      first_name: "Sam",
      last_name: "Rivera",
      headline: "Founder",
      role: "Founder",
      about: "",
      location: "Remote",
      company: "Acme",
      company_overview: "",
    },
  },
];

export function BuilderTab({
  campaignId,
  running,
  accounts = [],
  onChanged,
}: {
  campaignId: string;
  running: boolean;
  accounts?: SenderAccount[];
  /** Fired after "Build with AI" persists brain/cadence, so the parent can refresh. */
  onChanged?: () => void;
}) {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<NodeStatsResponse | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);

  // Autosave bookkeeping (debounced silent PUT; survives tab switch / reload).
  const nodesRef = useRef<GraphNode[]>(nodes);
  const dirtyRef = useRef(dirty);
  const runningRef = useRef(running);
  const debouncer = useRef<Debouncer | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const editGenRef = useRef(0);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.request<{ nodes: GraphNode[] }>(`/campaigns/${campaignId}/sequence`);
      setNodes(res.nodes ?? []);
      setDirty(false);
      // Live stats — best-effort; the canvas renders without them.
      void api
        .request<Record<string, number>>(`/campaigns/${campaignId}/sequence/node-counts`)
        .then((c) => setCounts(c ?? {}))
        .catch(() => setCounts({}));
      void api
        .request<NodeStatsResponse>(`/campaigns/${campaignId}/sequence/node-stats`)
        .then(setStats)
        .catch(() => setStats(null));
    } catch (err) {
      setError(errorMessage(err, "Could not load sequence"));
    } finally {
      setLoading(false);
    }
  }, [api, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback((next: GraphNode[]): void => {
    editGenRef.current += 1;
    setNodes(next);
    setDirty(true);
    scheduleAutosave();
  }, []);

  // --- builder handlers ----------------------------------------------------

  const insertNode = (edge: Edge, kind: "action" | "condition", type: string): void => {
    const node = createNode(kind, type, defaultConfigFor(type));
    let next = insertNodeAtEdge(nodes, edge, node);
    // Voice notes auto-append a short "quick voice note for context" message (§7).
    if (type === "send_voice_note") {
      const msg = createNode("action", "send_message", { body: "Quick voice note for context 🎙️" });
      next = insertNodeAtEdge(next, { parentId: node.id, slot: "next" }, msg);
    }
    mutate(next);
    if (isComposerType(type)) {
      setSelectedId(node.id);
    }
  };

  const insertTemplate = (edge: Edge, which: TemplateKind): void => {
    const { chain, entryId, tailNodeId } = buildTemplate(which);
    mutate(insertChainAtEdge(nodes, edge, chain, entryId, tailNodeId));
  };

  const remove = (id: string): void => {
    if (selectedId === id) {
      setSelectedId(null);
    }
    mutate(removeNodeFromGraph(nodes, id));
  };

  const move = (id: string, dir: -1 | 1): void => {
    mutate(moveNode(nodes, id, dir));
  };

  const updateConfig = (id: string, key: string, value: unknown): void => {
    const node = byId(nodes).get(id);
    if (!node) {
      return;
    }
    mutate(setNodeConfig(nodes, id, { ...node.config, [key]: value }));
  };

  const setConfig = (id: string, config: Record<string, unknown>): void => {
    mutate(setNodeConfig(nodes, id, config));
  };

  const changeType = (id: string, type: string): void => {
    const node = byId(nodes).get(id);
    if (!node) {
      return;
    }
    mutate(changeNodeType(nodes, id, type, configForTypeChange(node.config, type)));
  };

  // AI generator replaces the canvas with a linear chain.
  const applyGenerated = (gen: GenNode[]): void => {
    setSelectedId(null);
    mutate(linearChain(gen.map((n) => ({ kind: n.kind, type: n.type, config: n.config }))));
  };

  // Workflows picker drops a prebuilt/saved graph onto the canvas (confirm-to-replace
  // is handled inside the picker).
  const applyWorkflowGraph = (graph: GraphNode[]): void => {
    setSelectedId(null);
    mutate(graph);
  };

  const loadSamples = useCallback(async (): Promise<PreviewSample[]> => {
    try {
      const res = await api.request<PreviewSample[]>(`/campaigns/${campaignId}/preview-samples`);
      return res && res.length > 0 ? res : DEMO_SAMPLES;
    } catch {
      return DEMO_SAMPLES;
    }
  }, [api, campaignId]);

  // --- autosave (silent, debounced full-replace PUT) -----------------------

  const autosave = useCallback(async (): Promise<void> => {
    if (runningRef.current || !dirtyRef.current) {
      return;
    }
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    const gen = editGenRef.current;
    try {
      await api.request(`/campaigns/${campaignId}/sequence`, {
        method: "PUT",
        body: { nodes: toSavePayload(nodesRef.current) },
      });
      setError(null);
      // The graph changed (AI/voice nodes affect required inputs) → refresh the gate.
      onChanged?.();
      if (editGenRef.current === gen) {
        dirtyRef.current = false;
        setDirty(false);
      }
    } catch (err) {
      setError(errorMessage(err, "Autosave failed — your edits are kept here; they'll retry automatically."));
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void autosaveRef.current();
      }
    }
  }, [api, campaignId, onChanged]);

  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  // Lazily build the trailing-edge debouncer (tested in lib/util/debounce.test.ts).
  // It always invokes the LATEST autosave via the stable ref, so a burst of edits
  // coalesces into a single save 1.2s after the user pauses — not one per keystroke.
  if (!debouncer.current) {
    debouncer.current = createDebouncer(() => void autosaveRef.current(), AUTOSAVE_DEBOUNCE_MS);
  }

  const scheduleAutosave = useCallback((): void => {
    debouncer.current?.schedule();
  }, []);

  useEffect(() => {
    return () => {
      // Flush any pending edits on unmount so nothing is lost when leaving the tab.
      debouncer.current?.flush();
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (dirtyRef.current && !runningRef.current) {
        void autosaveRef.current();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const ctx: BuilderContextValue = useMemo(
    () => ({
      running,
      nodeMap: byId(nodes),
      root: rootId(nodes),
      counts,
      stats,
      selectedId,
      insertNode,
      insertTemplate,
      remove,
      move,
      updateConfig,
      selectComposer: setSelectedId,
    }),
    // Handlers close over `nodes`; recompute when the graph or stats change.
    [nodes, counts, stats, selectedId, running],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading sequence…</p>;
  }

  const selected = nodes.find((n) => n.id === selectedId && isComposerType(n.type)) ?? null;
  return (
    // Full-bleed canvas fills the whole tab; the only chrome is two floating
    // controls (Build with AI / Workflows) so the sequence gets maximum space.
    <div className="flex h-full flex-col">
      {running ? (
        <div className="mx-5 mt-4 flex-shrink-0 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Stop the campaign to edit its sequence.
        </div>
      ) : null}

      {error ? <p className="flex-shrink-0 px-5 pt-3 text-sm text-destructive">{error}</p> : null}

      {/* Full-bleed canvas — fills the remaining height. Selecting a text-bearing
          step opens a full-focus SlideOver overlay (same ComposerPanel, props). */}
      <div className="relative min-h-0 flex-1">
        <BuilderProvider value={ctx}>
          <SequenceCanvas />
        </BuilderProvider>

        {!running ? (
          <div className="absolute right-3 top-3 z-10 flex gap-2">
            <Button variant="secondary" size="sm" className="shadow-raised" onClick={() => setBuildOpen(true)}>
              <Wand2 />
              Build with AI
            </Button>
            <Button variant="secondary" size="sm" className="shadow-raised" onClick={() => setWorkflowsOpen(true)}>
              <Workflow />
              Workflows
            </Button>
          </div>
        ) : null}
      </div>

      <BuildWithAiModal
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        campaignId={campaignId}
        onApply={applyGenerated}
        onApplied={onChanged}
      />

      <WorkflowsPicker
        open={workflowsOpen}
        onClose={() => setWorkflowsOpen(false)}
        currentGraph={nodes}
        onUse={applyWorkflowGraph}
      />

      {selected ? (
        <SlideOver
          open
          onClose={() => setSelectedId(null)}
          title={nodeLabel(selected.type)}
          widthClass="w-[448px] max-w-[92vw]"
        >
          <div className="p-5">
            <ComposerPanel
              key={selected.id}
              type={selected.type}
              config={selected.config}
              onConfigChange={(config) => setConfig(selected.id, config)}
              onChangeType={(t) => changeType(selected.id, t)}
              onCollapse={() => setSelectedId(null)}
              accounts={accounts}
              workspaceId={activeWorkspaceId ?? ""}
              campaignId={campaignId}
              leadCount={counts[selected.id] ?? 0}
              running={running}
              loadSamples={loadSamples}
            />
          </div>
        </SlideOver>
      ) : null}
    </div>
  );
}
