"use client";

import { type GenNode, isBodyConfigured } from "@10xconnect/core";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, GitBranch, Layers, MessageSquare, Play, Plus, Sparkles, Trash2, Users, Wand2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BuildWithAiModal } from "./build-with-ai";
import { ComposerPanel } from "./composer/composer-panel";
import type { PreviewSample } from "./composer/preview-modal";
import type { SenderAccount } from "./composer/sender-select";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import {
  configForTypeChange,
  hasTextBody,
  isComposerType,
  readComposer,
} from "@/lib/campaigns/composer";
import { ACTION_NODES, CONDITION_NODES, nodeDef } from "@/lib/campaigns/nodes";
import { useWorkspace } from "@/lib/workspace/context";

interface GraphNode {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
  next: string | null;
  true: string | null;
  false: string | null;
  delayDays: number | null;
}

interface Step {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
}

let localCounter = 0;
const localId = (): string => `n${Date.now()}_${localCounter++}`;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

// Used when the campaign has no leads so Preview always shows something. The second
// lead has empty Biography/Company Overview to demonstrate fallback + skip-on-empty.
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

/** Follow the saved chain (next / true edges) into an ordered step list. */
function linearize(nodes: GraphNode[]): Step[] {
  if (nodes.length === 0) {
    return [];
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const targeted = new Set<string>();
  for (const n of nodes) {
    for (const e of [n.next, n.true, n.false]) {
      if (e) {
        targeted.add(e);
      }
    }
  }
  let cur: GraphNode | undefined = nodes.find((n) => !targeted.has(n.id)) ?? nodes[0];
  const steps: Step[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    steps.push({ id: cur.id, kind: cur.kind, type: cur.type, config: cur.config ?? {} });
    const nextId: string | null = cur.kind === "condition" ? cur.true : cur.next;
    cur = nextId ? byId.get(nextId) : undefined;
  }
  return steps;
}

const TEMPLATE: Step[] = [
  { id: localId(), kind: "action", type: "like_last_post", config: {} },
  { id: localId(), kind: "action", type: "send_connection_request", config: {} },
  { id: localId(), kind: "condition", type: "invite_accepted", config: {} },
  { id: localId(), kind: "action", type: "wait_x_days", config: { days: 1 } },
  {
    id: localId(),
    kind: "action",
    type: "send_message",
    config: { body: "Hi {first_name}, thanks for connecting! What are you focused on at {company} this quarter?" },
  },
];

// Follow-up discipline templates (§7). Ids are assigned when inserted.
function engagementNurtureSteps(): Step[] {
  return [
    { id: "", kind: "action", type: "like_last_post", config: {} },
    { id: "", kind: "action", type: "wait_x_days", config: { days: 2 } },
    { id: "", kind: "action", type: "visit_profile", config: {} },
    { id: "", kind: "action", type: "wait_x_days", config: { days: 2 } },
    { id: "", kind: "action", type: "comment_last_post", config: {} },
  ];
}
function revisitSteps(): Step[] {
  return [
    { id: "", kind: "action", type: "wait_x_days", config: { days: 60 } },
    {
      id: "",
      kind: "action",
      type: "send_message",
      config: { body: "Hi {first_name}, circling back with a fresh angle — worth a quick chat about {company}?" },
    },
  ];
}

export function BuilderTab({
  campaignId,
  running,
  accounts = [],
}: {
  campaignId: string;
  running: boolean;
  accounts?: SenderAccount[];
}) {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeCounts, setNodeCounts] = useState<Record<string, number>>({});
  const [buildOpen, setBuildOpen] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.request<{ nodes: GraphNode[] }>(`/campaigns/${campaignId}/sequence`);
      setSteps(linearize(res.nodes));
      setDirty(false);
      try {
        const counts = await api.request<Record<string, number>>(
          `/campaigns/${campaignId}/sequence/node-counts`,
        );
        setNodeCounts(counts ?? {});
      } catch {
        setNodeCounts({});
      }
    } catch (err) {
      setError(errorMessage(err, "Could not load sequence"));
    } finally {
      setLoading(false);
    }
  }, [api, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = (next: Step[]): void => {
    setSteps(next);
    setDirty(true);
    setSaved(false);
  };
  const addStep = (kind: "action" | "condition", type: string): void => {
    const id = localId();
    const added: Step[] = [{ id, kind, type, config: type === "wait_x_days" ? { days: 3 } : {} }];
    // Voice notes auto-append a short "quick voice note for context" message (§7).
    if (type === "send_voice_note") {
      added.push({
        id: localId(),
        kind: "action",
        type: "send_message",
        config: { body: "Quick voice note for context 🎙️" },
      });
    }
    mutate([...steps, ...added]);
    if (isComposerType(type)) {
      setSelectedId(id);
    }
  };
  const insertTemplate = (which: "nurture" | "revisit"): void => {
    const tpl = which === "nurture" ? engagementNurtureSteps() : revisitSteps();
    mutate([...steps, ...tpl.map((s) => ({ ...s, id: localId() }))]);
  };

  // AI generator (E4): replace the canvas with the generated graph. Editable +
  // never auto-launched — the user reviews then clicks Run it!.
  const applyGenerated = (nodes: GenNode[]): void => {
    setSelectedId(null);
    mutate(nodes.map((n) => ({ id: localId(), kind: n.kind, type: n.type, config: n.config })));
  };
  const refine = async (): Promise<void> => {
    const instruction = refineText.trim();
    if (!instruction || refining) {
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const currentGraph = steps.map((s) => ({ kind: s.kind, type: s.type, config: s.config }));
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
  const setConfig = (id: string, config: Record<string, unknown>): void => {
    mutate(steps.map((s) => (s.id === id ? { ...s, config } : s)));
  };
  const updateConfig = (id: string, key: string, value: unknown): void => {
    mutate(steps.map((s) => (s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s)));
  };
  const changeType = (id: string, type: string): void => {
    mutate(
      steps.map((s) =>
        s.id === id ? { ...s, type, config: configForTypeChange(s.config, type) } : s,
      ),
    );
  };
  const remove = (id: string): void => {
    if (selectedId === id) {
      setSelectedId(null);
    }
    mutate(steps.filter((s) => s.id !== id));
  };
  const move = (index: number, dir: -1 | 1): void => {
    const j = index + dir;
    if (j < 0 || j >= steps.length) {
      return;
    }
    const next = [...steps];
    [next[index], next[j]] = [next[j], next[index]];
    mutate(next);
  };

  const loadSamples = useCallback(async (): Promise<PreviewSample[]> => {
    try {
      const res = await api.request<PreviewSample[]>(`/campaigns/${campaignId}/preview-samples`);
      return res && res.length > 0 ? res : DEMO_SAMPLES;
    } catch {
      return DEMO_SAMPLES;
    }
  }, [api, campaignId]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const nodes = steps.map((s, i) => {
        const nextLocal = steps[i + 1]?.id ?? null;
        return {
          id: s.id,
          kind: s.kind,
          type: s.type,
          config: s.config,
          next: s.kind === "action" ? nextLocal : null,
          true: s.kind === "condition" ? nextLocal : null,
          false: null,
          delayDays: s.type === "wait_x_days" ? Number(s.config.days) || 1 : null,
        };
      });
      const res = await api.request<{ nodes: GraphNode[] }>(`/campaigns/${campaignId}/sequence`, {
        method: "PUT",
        body: { nodes },
      });
      setSteps(linearize(res.nodes));
      setSelectedId(null); // node ids are reassigned on save
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, "Could not save sequence"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading sequence…</p>;
  }

  const selected = steps.find((s) => s.id === selectedId && isComposerType(s.type)) ?? null;

  return (
    <div className="space-y-4">
      {running ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Stop the campaign to edit its sequence.
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </p>
        <div className="flex gap-2">
          {steps.length === 0 && !running ? (
            <>
              <Button variant="outline" onClick={() => setBuildOpen(true)}>
                <Wand2 />
                Build with AI
              </Button>
              <Button variant="outline" onClick={() => mutate(TEMPLATE.map((s) => ({ ...s, id: localId() })))}>
                <Sparkles />
                Use recommended template
              </Button>
            </>
          ) : null}
          <Button onClick={() => void save()} disabled={!dirty || saving || running}>
            {saving ? "Saving…" : saved && !dirty ? "Saved" : "Save sequence"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {steps.length > 0 && !running ? (
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
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(340px,380px)] lg:items-start">
        <div
          className="rounded-2xl border bg-background px-4 py-7"
          style={{
            backgroundImage: "radial-gradient(hsl(30 20% 20% / 0.08) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            backgroundPosition: "11px 11px",
          }}
        >
          <div className="flex flex-col items-stretch">
            {/* Campaign start */}
            <div className="mx-auto inline-flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 font-display text-sm font-semibold shadow-soft">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Play className="size-3.5" />
              </span>
              Campaign start
            </div>

          {steps.map((step, i) => {
            const def = nodeDef(step.type);
            const composer = isComposerType(step.type);
            const isSelected = selectedId === step.id && composer;
            const count = nodeCounts[step.id] ?? 0;
            const misconfigured = composer
              ? hasTextBody(step.type)
                ? !isBodyConfigured(readComposer(step.type, step.config).body)
                : step.type === "send_voice_note" &&
                  !readComposer(step.type, step.config).audioRef.trim()
              : false;
            return (
              <div key={step.id} className="relative">
                <div className="mx-auto h-4 w-px bg-border" />
                <div
                  className={
                    "surface-card p-4 transition-shadow" +
                    (composer ? " cursor-pointer" : "") +
                    (isSelected ? " ring-2 ring-primary/40" : "")
                  }
                  onClick={composer ? () => setSelectedId(step.id) : undefined}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={
                        step.kind === "condition"
                          ? "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-tint-violet text-[hsl(265_45%_45%)]"
                          : "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                      }
                    >
                      {step.kind === "condition" ? (
                        <GitBranch className="size-4" />
                      ) : composer ? (
                        <MessageSquare className="size-4" />
                      ) : (
                        <Zap className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium">{def?.label ?? step.type}</div>
                        {misconfigured ? (
                          <Badge variant="warning">
                            <AlertTriangle className="size-3" />
                            Action required
                          </Badge>
                        ) : null}
                        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="size-3.5" />
                          {count}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">{def?.description}</div>

                      {composer ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {isSelected ? "Editing in the composer →" : "Click to open the composer"}
                        </p>
                      ) : def && def.fields.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {def.fields.map((f) => (
                            <div key={f.key} className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                              {f.type === "textarea" ? (
                                <Textarea
                                  value={String(step.config[f.key] ?? "")}
                                  onChange={(e) => updateConfig(step.id, f.key, e.target.value)}
                                  placeholder={f.placeholder}
                                  disabled={running}
                                />
                              ) : (
                                <Input
                                  type={f.type === "number" ? "number" : "text"}
                                  value={String(step.config[f.key] ?? "")}
                                  onChange={(e) =>
                                    updateConfig(
                                      step.id,
                                      f.key,
                                      f.type === "number" ? Number(e.target.value) : e.target.value,
                                    )
                                  }
                                  placeholder={f.placeholder}
                                  disabled={running}
                                />
                              )}
                              {f.help ? <p className="text-[11px] text-muted-foreground">{f.help}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {step.kind === "condition" ? (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          On <span className="font-medium text-success">yes</span> → continue to the next
                          step. On <span className="font-medium text-destructive">no</span> → stop.
                        </p>
                      ) : null}
                    </div>

                    {!running ? (
                      <div
                        className="flex shrink-0 gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="icon" onClick={() => move(i, -1)} aria-label="Move up">
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => move(i, 1)} aria-label="Move down">
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(step.id)}
                          aria-label="Delete step"
                          className="text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          {!running ? (
            <>
              <div className="mx-auto h-4 w-px bg-border" />
              <div className="flex flex-wrap justify-center gap-2">
                <AddMenu label="Add action" icon={<Plus className="size-4" />} items={ACTION_NODES} onPick={(t) => addStep("action", t)} />
                <AddMenu
                  label="Add condition"
                  icon={<GitBranch className="size-4" />}
                  items={CONDITION_NODES}
                  onPick={(t) => addStep("condition", t)}
                />
                <AddMenu
                  label="Insert template"
                  icon={<Layers className="size-4" />}
                  items={[
                    { type: "nurture", label: "Engagement nurture", description: "like → wait → visit → wait → comment" },
                    { type: "revisit", label: "Revisit later", description: "long wait, then a fresh-angle message" },
                  ]}
                  onPick={(t) => insertTemplate(t as "nurture" | "revisit")}
                />
              </div>
            </>
          ) : null}
          </div>
        </div>

        {/* Composer panel (docked right on lg, stacked below otherwise) */}
        <div className="lg:sticky lg:top-4">
          {selected ? (
            <div className="surface-card p-4">
              <ComposerPanel
                key={selected.id}
                type={selected.type}
                config={selected.config}
                onConfigChange={(config) => setConfig(selected.id, config)}
                onChangeType={(t) => changeType(selected.id, t)}
                accounts={accounts}
                workspaceId={activeWorkspaceId ?? ""}
                campaignId={campaignId}
                leadCount={nodeCounts[selected.id] ?? 0}
                running={running}
                loadSamples={loadSamples}
              />
            </div>
          ) : (
            <div className="surface-card hidden border-dashed p-6 text-center text-sm text-muted-foreground lg:block">
              Select a message, voice note, InMail, open-profile, or comment step to open the composer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddMenu({
  label,
  icon,
  items,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  items: { type: string; label: string; description: string }[];
  onPick: (type: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          {icon}
          {label}
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 w-64 overflow-auto">
        {items.map((it) => (
          <DropdownMenuItem key={it.type} onSelect={() => onPick(it.type)} className="flex-col items-start">
            <span className="text-sm font-medium">{it.label}</span>
            <span className="text-xs text-muted-foreground">{it.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
