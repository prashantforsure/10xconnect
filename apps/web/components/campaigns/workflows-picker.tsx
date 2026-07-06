"use client";

import { Flame, GitBranch, Handshake, Mic, Save, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/loader";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { type GraphNode, remapIds, toSavePayload } from "@/lib/campaigns/graph";
import { PREBUILT_WORKFLOWS, type PrebuiltWorkflow } from "@/lib/campaigns/workflows";

interface SavedWorkflow {
  id: string;
  name: string;
  graph: GraphNode[];
  createdAt?: string;
}

const ICONS: Record<PrebuiltWorkflow["icon"], ComponentType<{ className?: string }>> = {
  Handshake,
  Flame,
  Mic,
  GitBranch,
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

/**
 * The builder "Workflows" picker: choose a prebuilt (curated) workflow or one of
 * the workspace's saved workflows to drop onto the canvas, or save the current
 * canvas as a reusable workflow. Loading replaces the canvas — if there are
 * existing steps we confirm first (confirm-to-replace).
 */
export function WorkflowsPicker({
  open,
  onClose,
  currentGraph,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  currentGraph: GraphNode[];
  /** Apply a fresh graph onto the canvas (caller mutates state + autosaves). */
  onUse: (graph: GraphNode[]) => void;
}) {
  const api = useApi();
  const [saved, setSaved] = useState<SavedWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A graph staged for confirm-to-replace (only when the canvas already has steps).
  const [pending, setPending] = useState<{ graph: GraphNode[]; title: string } | null>(null);
  // The "save current canvas as a workflow" sub-flow.
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const reqRef = useRef(0);

  const hasSteps = currentGraph.length > 0;

  const load = useCallback(async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<SavedWorkflow[]>(`/workflows`);
      if (reqId === reqRef.current) {
        setSaved(res ?? []);
      }
    } catch (err) {
      if (reqId === reqRef.current) {
        setError(errorMessage(err, "Could not load saved workflows"));
      }
    } finally {
      if (reqId === reqRef.current) {
        setLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    if (open) {
      setPending(null);
      setSaveMode(false);
      setSaveName("");
      void load();
    }
  }, [open, load]);

  const close = (): void => {
    setPending(null);
    setSaveMode(false);
    setError(null);
    onClose();
  };

  // Apply a graph: confirm first if the canvas already has steps.
  const use = (graph: GraphNode[], title: string): void => {
    if (hasSteps) {
      setPending({ graph, title });
      return;
    }
    onUse(graph);
    close();
  };

  const confirmReplace = (): void => {
    if (!pending) {
      return;
    }
    onUse(pending.graph);
    close();
  };

  const saveCurrent = async (): Promise<void> => {
    if (!saveName.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.request(`/workflows`, {
        method: "POST",
        body: { name: saveName.trim(), graph: toSavePayload(currentGraph) },
      });
      setSaveMode(false);
      setSaveName("");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not save workflow"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w: SavedWorkflow): Promise<void> => {
    setError(null);
    try {
      await api.request(`/workflows/${w.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not delete workflow"));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={pending ? "Replace your sequence?" : saveMode ? "Save current sequence" : "Workflows"}
      description={
        pending
          ? `This replaces the ${currentGraph.length} step${currentGraph.length === 1 ? "" : "s"} on your canvas with “${pending.title}”. This can't be undone.`
          : saveMode
            ? "Save this canvas as a reusable workflow. Only the structure is saved — never your sending account, media, or per-contact messages."
            : "Drop a ready-made sequence onto the canvas, or reuse one you saved. Prebuilt workflows follow our methodology (no-note connects, conversation-first)."
      }
      className="max-w-2xl"
    >
      {pending ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button onClick={confirmReplace}>Replace sequence</Button>
        </div>
      ) : saveMode ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wf-name">Workflow name</Label>
            <Input
              id="wf-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void saveCurrent();
                }
              }}
              placeholder="My 3-touch connector"
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaveMode(false)} disabled={saving}>
              Back
            </Button>
            <Button onClick={() => void saveCurrent()} disabled={!saveName.trim() || saving}>
              {saving ? "Saving…" : "Save workflow"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {/* Prebuilt */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prebuilt</p>
            <ul className="space-y-2">
              {PREBUILT_WORKFLOWS.map((w) => {
                const Icon = ICONS[w.icon];
                return (
                  <li
                    key={w.key}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{w.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{w.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground/80">{w.hint}</p>
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0" onClick={() => use(w.build(), w.title)}>
                      Use
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Saved */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Saved in this workspace
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSaveName("");
                  setSaveMode(true);
                }}
                disabled={!hasSteps}
                title={hasSteps ? undefined : "Add steps to the canvas first"}
              >
                <Save className="size-4" />
                Save current
              </Button>
            </div>
            {loading ? (
              <PageLoader />
            ) : saved.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No saved workflows yet. Build a sequence and click “Save current” to reuse it later.
              </div>
            ) : (
              <ul className="max-h-[32vh] space-y-2 overflow-y-auto pr-1">
                {saved.map((w) => {
                  const steps = w.graph?.length ?? 0;
                  return (
                    <li
                      key={w.id}
                      className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{w.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {steps} step{steps === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => void remove(w)}
                          aria-label={`Delete ${w.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                        <Button size="sm" onClick={() => use(remapIds(w.graph), w.name)}>
                          Use
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The icon used for the builder's "Workflows" trigger button. */
export { WorkflowIcon };
