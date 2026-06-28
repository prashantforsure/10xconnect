"use client";

import { type GenNode } from "@10xconnect/core";
import { Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BuildWithAiModal } from "./build-with-ai";
import { SequenceCanvas } from "./builder/canvas";
import { type BuilderContextValue, BuilderProvider, type NodeStatsResponse } from "./builder/context";
import { ComposerPanel } from "./composer/composer-panel";
import type { PreviewSample } from "./composer/preview-modal";
import type { SenderAccount } from "./composer/sender-select";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Recommended starter sequence (linear; the user can fork it afterwards).
const TEMPLATE_FLAT: { kind: "action" | "condition"; type: string; config: Record<string, unknown> }[] = [
  { kind: "action", type: "like_last_post", config: {} },
  { kind: "action", type: "send_connection_request", config: {} },
  { kind: "condition", type: "invite_accepted", config: {} },
  { kind: "action", type: "wait_x_days", config: { days: 1 } },
  {
    kind: "action",
    type: "send_message",
    config: { body: "Hi {first_name}, thanks for connecting! What are you focused on at {company} this quarter?" },
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<NodeStatsResponse | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);

  // Autosave bookkeeping (debounced silent PUT; survives tab switch / reload).
  const nodesRef = useRef<GraphNode[]>(nodes);
  const dirtyRef = useRef(dirty);
  const runningRef = useRef(running);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // AI generator + recommended template replace the canvas with a linear chain.
  const applyGenerated = (gen: GenNode[]): void => {
    setSelectedId(null);
    mutate(linearChain(gen.map((n) => ({ kind: n.kind, type: n.type, config: n.config }))));
  };

  const refine = async (): Promise<void> => {
    const instruction = refineText.trim();
    if (!instruction || refining) {
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const currentGraph = nodes.map((s) => ({ kind: s.kind, type: s.type, config: s.config }));
      const res = await api.request<{ nodes: GenNode[] }>(`/campaigns/${campaignId}/generate`, {
        method: "POST",
        body: { instruction, currentGraph },
      });
      applyGenerated(res.nodes);
      setRefineText("");
    } catch (err) {
      setError(errorMessage(err, "Could not refine the sequence"));
    } finally {
      setRefining(false);
    }
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
    setSaving(true);
    try {
      await api.request(`/campaigns/${campaignId}/sequence`, {
        method: "PUT",
        body: { nodes: toSavePayload(nodesRef.current) },
      });
      setLastSavedAt(Date.now());
      setError(null);
      // The graph changed (AI/voice nodes affect required inputs) → refresh the gate.
      onChanged?.();
      if (editGenRef.current === gen) {
        dirtyRef.current = false;
        setDirty(false);
      }
    } catch (err) {
      setError(errorMessage(err, "Autosave failed — your edits are kept here; click Save now to retry"));
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void autosaveRef.current();
      }
    }
  }, [api, campaignId, onChanged]);

  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  const scheduleAutosave = useCallback((): void => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }
    autosaveTimer.current = setTimeout(() => void autosaveRef.current(), AUTOSAVE_DEBOUNCE_MS);
  }, []);

  const flushSave = useCallback((): void => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }
    void autosaveRef.current();
  }, []);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
      void autosaveRef.current();
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
  const stepCount = nodes.length;

  return (
    <div className="space-y-4">
      {running ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Stop the campaign to edit its sequence.
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          <p>
            {stepCount} step{stepCount === 1 ? "" : "s"}
          </p>
          {!running ? <SaveStatus saving={saving} dirty={dirty} lastSavedAt={lastSavedAt} /> : null}
        </div>
        <div className="flex gap-2">
          {stepCount === 0 && !running ? (
            <>
              <Button variant="outline" onClick={() => setBuildOpen(true)}>
                <Wand2 />
                Build with AI
              </Button>
              <Button variant="outline" onClick={() => applyGenerated(TEMPLATE_FLAT as GenNode[])}>
                <Sparkles />
                Use recommended template
              </Button>
            </>
          ) : null}
          <Button onClick={flushSave} disabled={!dirty || saving || running}>
            {saving ? "Saving…" : "Save now"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {stepCount > 0 && !running ? (
        <div className="flex items-center gap-2 rounded-xl border bg-secondary/40 px-3 py-2">
          <Wand2 className="size-4 shrink-0 text-primary" />
          <Input
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void refine();
              }
            }}
            placeholder="Refine with AI… e.g. add a voice note, make it gentler, remove the InMail"
            className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
            disabled={refining}
          />
          <Button size="sm" variant="outline" onClick={() => void refine()} disabled={refining || !refineText.trim()}>
            {refining ? "Refining…" : "Refine"}
          </Button>
        </div>
      ) : null}

      <BuildWithAiModal
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        campaignId={campaignId}
        onApply={applyGenerated}
        onApplied={onChanged}
      />

      {/* Canvas keeps a fixed-size viewport; the composer docks beside it (and is
          collapsible) only when a text-bearing step is selected. minmax(0,1fr) lets
          the canvas scroll internally instead of growing the page when zoomed. */}
      <div className={`grid gap-4 lg:items-start ${selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(340px,380px)]" : "lg:grid-cols-1"}`}>
        <BuilderProvider value={ctx}>
          <SequenceCanvas />
        </BuilderProvider>

        {selected ? (
          <div className="lg:sticky lg:top-4">
            <div className="surface-card p-4">
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SaveStatus({
  saving,
  dirty,
  lastSavedAt,
}: {
  saving: boolean;
  dirty: boolean;
  lastSavedAt: number | null;
}) {
  const text = saving
    ? "Saving…"
    : dirty
      ? "Unsaved changes — autosaving…"
      : lastSavedAt
        ? "All changes saved"
        : "Autosaves as you edit";
  return <p className="mt-0.5 text-xs text-muted-foreground/80">{text}</p>;
}
