"use client";

import { type GenNode, lintSequenceTiming } from "@10xconnect/core";
import { AlertTriangle, Check, Loader2, Redo2, Undo2, Wand2, Workflow, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BuildWithAiModal } from "./build-with-ai";
import { SequenceCanvas } from "./builder/canvas";
import { type BuilderContextValue, BuilderProvider, type NodeStatsResponse } from "./builder/context";
import { ComposerPanel } from "./composer/composer-panel";
import type { PreviewSample } from "./composer/preview-modal";
import type { SenderAccount } from "./composer/sender-select";
import { WorkflowsPicker } from "./workflows-picker";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SlideOver } from "@/components/ui/slide-over";
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
import { nodeLabel } from "@/lib/campaigns/nodes";
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

/** Subtle autosave status chip: "Saving…" while dirty, "Saved" once flushed. */
function SaveStatus({ dirty, lastSavedAt }: { dirty: boolean; lastSavedAt: number | null }) {
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 py-1 text-[11px] text-muted-foreground shadow-raised backdrop-blur">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 py-1 text-[11px] text-muted-foreground shadow-raised backdrop-blur">
        <Check className="size-3 text-success" />
        Saved
      </span>
    );
  }
  return null;
}

/** One figure in the floating SENT / ACCEPTED / REPLIED campaign summary card. */
function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "success" | "primary";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={
          "text-sm font-bold tabular-nums " +
          (accent === "success" ? "text-success" : accent === "primary" ? "text-primary" : "text-foreground")
        }
      >
        {value.toLocaleString()}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
    </span>
  );
}

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
  // Timestamp of the last successful autosave — drives the "All changes saved" chip.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<NodeStatsResponse | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  // Deleting a node whose branch gets pruned with it needs an explicit confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; downstream: number } | null>(null);
  // Campaign-level SENT / ACCEPTED / REPLIED for the floating summary card (§9).
  const [summary, setSummary] = useState<{ sent: number; accepted: number; replied: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Undo/redo over graph snapshots. Consecutive config edits to the same node
  // coalesce into one entry (via histKey) so typing doesn't flood the stack.
  const undoStack = useRef<GraphNode[][]>([]);
  const redoStack = useRef<GraphNode[][]>([]);
  const lastHistKey = useRef<string | null>(null);
  // Bumped whenever the stacks change so the Undo/Redo buttons re-render.
  const [, setHistVersion] = useState(0);

  // Autosave bookkeeping (debounced silent PUT; survives tab switch / reload).
  const nodesRef = useRef<GraphNode[]>(nodes);
  const dirtyRef = useRef(dirty);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.request<{ nodes: GraphNode[] }>(`/campaigns/${campaignId}/sequence`);
      setNodes(res.nodes ?? []);
      setDirty(false);
      // Fresh graph = fresh history (server node ids may have been remapped).
      undoStack.current = [];
      redoStack.current = [];
      lastHistKey.current = null;
      setHistVersion((v) => v + 1);
      // Live stats — best-effort; the canvas renders without them.
      void api
        .request<Record<string, number>>(`/campaigns/${campaignId}/sequence/node-counts`)
        .then((c) => setCounts(c ?? {}))
        .catch(() => setCounts({}));
      void api
        .request<NodeStatsResponse>(`/campaigns/${campaignId}/sequence/node-stats`)
        .then(setStats)
        .catch(() => setStats(null));
      void api
        .request<{
          requests: number;
          messages: number;
          inmails: number;
          voiceNotes: number;
          openMessages: number;
          acceptedInvites: { count: number };
          replies: { count: number };
        }>(`/analytics/campaign/${campaignId}`)
        .then((a) =>
          setSummary({
            sent: a.requests + a.messages + a.inmails + a.voiceNotes + a.openMessages,
            accepted: a.acceptedInvites.count,
            replied: a.replies.count,
          }),
        )
        .catch(() => setSummary(null));
    } catch (err) {
      setError(errorMessage(err, "Could not load sequence"));
    } finally {
      setLoading(false);
    }
  }, [api, campaignId]);

  // Reload on mount AND whenever the campaign flips between live/stopped: a full
  // save remaps node ids server-side, so re-syncing here guarantees the ids we
  // send for live content-only saves match what the server has stored.
  useEffect(() => {
    void load();
  }, [load, running]);

  const mutate = useCallback((next: GraphNode[], histKey?: string): void => {
    if (!histKey || histKey !== lastHistKey.current) {
      undoStack.current.push(nodesRef.current);
      if (undoStack.current.length > 50) {
        undoStack.current.shift();
      }
      redoStack.current = [];
      setHistVersion((v) => v + 1);
    }
    lastHistKey.current = histKey ?? null;
    editGenRef.current += 1;
    setNodes(next);
    setDirty(true);
    scheduleAutosave();
  }, []);

  // Restore a snapshot from one stack, parking the current graph on the other.
  const restore = useCallback((from: "undo" | "redo"): void => {
    const source = from === "undo" ? undoStack.current : redoStack.current;
    const target = from === "undo" ? redoStack.current : undoStack.current;
    const snapshot = source.pop();
    if (!snapshot) {
      return;
    }
    target.push(nodesRef.current);
    lastHistKey.current = null;
    setHistVersion((v) => v + 1);
    editGenRef.current += 1;
    setNodes(snapshot);
    // Close the composer if its node no longer exists in the restored graph.
    setSelectedId((cur) => (cur && snapshot.some((n) => n.id === cur) ? cur : null));
    setDirty(true);
    scheduleAutosave();
  }, []);
  const undo = useCallback((): void => restore("undo"), [restore]);
  const redo = useCallback((): void => restore("redo"), [restore]);

  // Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y — only while the builder is the visible
  // tab (it stays mounted behind other tabs), the composer is closed, and focus
  // isn't in a text field (native undo wins there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") {
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (!rootRef.current || rootRef.current.offsetParent === null || selectedId) {
        return;
      }
      e.preventDefault();
      if (key === "y" || e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId]);

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

  const applyRemove = (id: string): void => {
    if (selectedId === id) {
      setSelectedId(null);
    }
    mutate(removeNodeFromGraph(nodes, id));
  };

  const remove = (id: string): void => {
    // A condition takes its whole false-branch subtree with it; anything beyond
    // the node itself is destructive enough to warrant an explicit confirm.
    const downstream = nodes.length - removeNodeFromGraph(nodes, id).length - 1;
    if (downstream > 0) {
      setConfirmDelete({ id, downstream });
      return;
    }
    applyRemove(id);
  };

  const move = (id: string, dir: -1 | 1): void => {
    mutate(moveNode(nodes, id, dir));
  };

  const updateConfig = (id: string, key: string, value: unknown): void => {
    const node = byId(nodes).get(id);
    if (!node) {
      return;
    }
    mutate(setNodeConfig(nodes, id, { ...node.config, [key]: value }), `cfg:${id}`);
  };

  const setConfig = (id: string, config: Record<string, unknown>): void => {
    mutate(setNodeConfig(nodes, id, config), `cfg:${id}`);
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

  const autosave = useCallback(async (opts?: { keepalive?: boolean }): Promise<void> => {
    // Live campaigns save too: the server accepts content-only updates (message
    // bodies, notes, wait durations) and rejects structural changes with a clear
    // message — which we surface via setError below.
    if (!dirtyRef.current) {
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
        // On tab-close the browser cancels in-flight fetches; keepalive lets the
        // final save complete after unload so nothing is lost.
        keepalive: opts?.keepalive,
      });
      setError(null);
      // The graph changed (AI/voice nodes affect required inputs) → refresh the gate.
      onChanged?.();
      if (editGenRef.current === gen) {
        dirtyRef.current = false;
        setDirty(false);
        setLastSavedAt(Date.now());
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
      if (dirtyRef.current) {
        void autosaveRef.current({ keepalive: true });
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Advisory pacing lint (E3 — never blocks save/run). Dismissable per visit.
  const timingFindings = useMemo(() => lintSequenceTiming(nodes), [nodes]);
  const [timingDismissed, setTimingDismissed] = useState(false);

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
    <div ref={rootRef} className="flex h-full flex-col">
      {running ? (
        <div className="mx-5 mt-4 flex-shrink-0 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          This campaign is live. Message content and wait times save automatically and apply to
          future sends — stop the campaign to add, remove, or reorder steps.
        </div>
      ) : null}

      {error ? <p className="flex-shrink-0 px-5 pt-3 text-sm text-destructive">{error}</p> : null}

      {timingFindings.length > 0 && !timingDismissed ? (
        <div className="mx-5 mt-3 flex-shrink-0 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <ul className="space-y-1">
              {timingFindings.map((f) => (
                <li key={`${f.id}:${f.nodeId ?? ""}`} className="flex items-start gap-1.5 text-xs text-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  {f.message}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setTimingDismissed(true)}
              aria-label="Dismiss timing advisories"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Full-bleed canvas — fills the remaining height. Selecting a text-bearing
          step opens a full-focus SlideOver overlay (same ComposerPanel, props). */}
      <div className="relative min-h-0 flex-1">
        <BuilderProvider value={ctx}>
          <SequenceCanvas />
        </BuilderProvider>

        <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <SaveStatus dirty={dirty} lastSavedAt={lastSavedAt} />
            <Button
              variant="secondary"
              size="icon"
              className="size-8 shadow-raised"
              onClick={undo}
              disabled={undoStack.current.length === 0}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="size-8 shadow-raised"
              onClick={redo}
              disabled={redoStack.current.length === 0}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 />
            </Button>
            {!running ? (
              <>
                <Button variant="secondary" size="sm" className="shadow-raised" onClick={() => setBuildOpen(true)}>
                  <Wand2 />
                  Build with AI
                </Button>
                <Button variant="secondary" size="sm" className="shadow-raised" onClick={() => setWorkflowsOpen(true)}>
                  <Workflow />
                  Workflows
                </Button>
              </>
            ) : null}
          </div>
          {summary && (running || summary.sent > 0) ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card/90 px-3 py-1.5 shadow-raised backdrop-blur">
              <SummaryStat label="Sent" value={summary.sent} />
              <div className="h-6 w-px bg-border" />
              <SummaryStat label="Accepted" value={summary.accepted} accent="success" />
              <div className="h-6 w-px bg-border" />
              <SummaryStat label="Replied" value={summary.replied} accent="primary" />
            </div>
          ) : null}
        </div>
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

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this step?"
        description={
          confirmDelete
            ? `Deleting it also removes the ${confirmDelete.downstream} downstream step${
                confirmDelete.downstream === 1 ? "" : "s"
              } on its branch. You can undo this with Ctrl+Z.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirmDelete) {
                applyRemove(confirmDelete.id);
              }
              setConfirmDelete(null);
            }}
          >
            Delete step
          </Button>
        </div>
      </Modal>

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
