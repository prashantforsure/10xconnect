"use client";

import { hasCampaignBrain } from "@10xconnect/core";
import { AlertTriangle, Check, FileText, Link2, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// --- types -----------------------------------------------------------------

interface Objective {
  goal?: string;
  offer?: string;
  success_criteria?: string;
  cta?: string;
  icp?: string;
}
interface Guardrails {
  never_discuss?: string[];
  escalate_on?: string[];
}
interface Voice {
  tone?: string;
  samples?: string[];
}
interface Autonomy {
  mode?: "approve_all" | "auto_easy_escalate_hard" | "full_auto";
  confidence_threshold?: number;
}
interface Limits {
  max_ai_turns?: number;
  cooldown_minutes?: number;
}
interface Budget {
  daily_usd_cap?: number | null;
  alert_at_pct?: number;
}
interface BrainView {
  objective: Objective | null;
  guardrails: Guardrails | null;
  voice: Voice | null;
  autonomy: Autonomy | null;
  limits: Limits | null;
  budget: Budget | null;
  knowledgeBaseId: string | null;
}
interface BudgetUsage {
  window: string;
  cap: number | null;
  alertAtPct: number;
  tokensUsed: number;
  usdUsed: number;
  softAlerted: boolean;
  hardStopped: boolean;
}
interface KbView {
  id: string;
  name: string;
  description: string | null;
  chunks: number;
}
interface KbSource {
  source: string;
  chunks: number;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

/** Parse a numeric input; blank → undefined (so the field is omitted, not 0). */
function toNum(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// --- shared bits -----------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SaveRow({
  onSave,
  saving,
  msg,
  label = "Save",
}: {
  onSave: () => void;
  saving: boolean;
  msg: string | null;
  label?: string;
}) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : label}
      </Button>
      {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
    </div>
  );
}

/** A small chip-list editor backing a string[] (e.g. guardrail topics). */
function TagEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (): void => {
    const v = draft.trim();
    if (v && !values.includes(v)) {
      onChange([...values, v]);
    }
    setDraft("");
  };
  return (
    <div className="rounded-lg border border-input bg-card p-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${v}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={values.length ? "" : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

/** A list of multi-line example replies (few-shot voice samples), max 10. */
function SamplesEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const update = (i: number, v: string): void =>
    onChange(values.map((s, idx) => (idx === i ? v : s)));
  const remove = (i: number): void => onChange(values.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      {values.map((s, i) => (
        <div key={i} className="flex items-start gap-2">
          <Textarea
            value={s}
            onChange={(e) => update(i, e.target.value)}
            placeholder="Paste a short example reply written in your voice…"
            className="min-h-[60px]"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 text-muted-foreground hover:text-destructive"
            aria-label={`Remove example ${i + 1}`}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() => onChange([...values, ""])}
        disabled={values.length >= 10}
      >
        Add example
      </Button>
    </div>
  );
}

// --- "AI is off" indicator (mirrors the inbound gate) ----------------------

/**
 * Shows when the campaign has no brain — the inbound pipeline only enqueues an AI
 * turn when a campaign has an objective OR a knowledge base (same predicate,
 * hasCampaignBrain). Until then replies just land in the inbox. Re-fetches when
 * `key` (a version bump) changes after the Aim / Knowledge cards save.
 */
/** Plain-English label for a campaign's AI reply mode. */
function modeLabelOf(mode: Autonomy["mode"] | undefined): string {
  switch (mode) {
    case "full_auto":
      return "Autopilot — replies to everything except hot leads";
    case "approve_all":
      return "Manual — you approve every reply";
    default:
      return "Balanced — auto-replies, escalates hot leads";
  }
}

/**
 * AI SDR readiness — the guided-activation surface. Turns the previously-buried
 * brain config into a first-class, named "AI SDR" with a checklist (aim,
 * knowledge base, reply mode) so a user can SEE whether the AI will actually
 * engage replies and what it takes to switch it on.
 */
function AiStatusBanner({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [brain, setBrain] = useState<BrainView | null>(null);

  const load = useCallback(async () => {
    try {
      setBrain(await api.request<BrainView>(`/campaigns/${campaignId}/brain`));
    } catch {
      setBrain(null);
    }
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!brain) {
    return null;
  }

  const hasAim = Boolean(brain.objective?.goal || brain.objective?.offer);
  const hasKb = Boolean(brain.knowledgeBaseId);
  const on = hasCampaignBrain({ objective: brain.objective, knowledgeBaseId: brain.knowledgeBaseId });
  const mode = brain.autonomy?.mode;
  const autoSends = mode !== "approve_all";
  const modeLabel = modeLabelOf(mode);

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5 text-sm",
        on ? "border-primary/30 bg-primary/[0.06]" : "border-warning/40 bg-warning/10",
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className={cn("size-4", on ? "text-primary" : "text-warning-foreground")} />
        <p className="font-semibold">
          {on ? "AI SDR is on for this campaign" : "AI SDR is off for this campaign"}
        </p>
        {on ? <span className="ml-auto text-xs text-muted-foreground">{modeLabel}</span> : null}
      </div>
      <p className="mt-1 text-muted-foreground">
        {on
          ? autoSends
            ? "The AI answers incoming replies automatically, stays grounded in your knowledge base, and hands hot leads to you with a briefing. Tune it below."
            : "The AI drafts a reply for every incoming message; you approve each one in the inbox. Switch to Balanced below to let it auto-send the easy ones."
          : "The AI won't engage incoming replies until this campaign has a brain. Complete the checklist below — replies still land in your inbox in the meantime."}
      </p>
      <ul className="mt-2.5 space-y-1">
        <ChecklistItem done={hasAim} label="Campaign aim & offer" hint="what the AI steers toward" />
        <ChecklistItem
          done={hasKb}
          label="Knowledge base linked"
          hint="so factual answers stay grounded (required for auto-answers)"
        />
        <ChecklistItem done label={`Reply mode — ${modeLabel}`} />
      </ul>
      {on && autoSends && !hasKb ? (
        <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
          Without a linked knowledge base the AI still handles conversation, but any factual question is
          escalated to you rather than answered.
        </p>
      ) : null}
    </div>
  );
}

function ChecklistItem({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {done ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
      ) : (
        <span className="mt-0.5 size-3.5 shrink-0 rounded-full border border-muted-foreground/50" />
      )}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
        {hint ? <span className="text-muted-foreground"> — {hint}</span> : null}
      </span>
    </li>
  );
}

// --- objective (aim / offer / success / CTA / ICP) -------------------------

function ObjectiveCard({
  campaignId,
  onChanged,
}: {
  campaignId: string;
  onChanged?: () => void;
}) {
  const api = useApi();
  const [o, setO] = useState<Objective>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const b = await api.request<BrainView>(`/campaigns/${campaignId}/brain`);
    setO(b.objective ?? {});
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      await api.request(`/campaigns/${campaignId}/brain`, {
        method: "PUT",
        body: { objective: o },
      });
      setMsg("Saved");
      onChanged?.();
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Campaign aim & offer"
      description="The goal the AI steers toward and what you're offering. Used to ground every AI reply."
    >
      <div className="space-y-4">
        <Field label="Aim" hint="What is this campaign trying to achieve?">
          <Textarea
            value={o.goal ?? ""}
            onChange={(e) => setO({ ...o, goal: e.target.value })}
            placeholder="e.g. Start conversations with founders and book intro calls."
          />
        </Field>
        <Field label="What you're offering" hint="Product/service + the value prop.">
          <Textarea
            value={o.offer ?? ""}
            onChange={(e) => setO({ ...o, offer: e.target.value })}
            placeholder="e.g. A LinkedIn outreach tool that keeps accounts safe while personalizing at scale."
          />
        </Field>
        <Field label="Success criteria" hint="What counts as a win.">
          <Input
            value={o.success_criteria ?? ""}
            onChange={(e) => setO({ ...o, success_criteria: e.target.value })}
            placeholder="e.g. A booked 20-minute demo call."
          />
        </Field>
        <Field label="Call-to-action" hint="The next step you want them to take.">
          <Input
            value={o.cta ?? ""}
            onChange={(e) => setO({ ...o, cta: e.target.value })}
            placeholder="e.g. Grab a quick call this week?"
          />
        </Field>
        <Field label="Ideal customer (optional)" hint="Who you're targeting.">
          <Input
            value={o.icp ?? ""}
            onChange={(e) => setO({ ...o, icp: e.target.value })}
            placeholder="e.g. Seed–Series A B2B SaaS founders."
          />
        </Field>
      </div>
      <SaveRow onSave={() => void save()} saving={saving} msg={msg} />
    </Section>
  );
}

// --- knowledge base (the AI answers ONLY from this) ------------------------

function KnowledgeCard({
  campaignId,
  onChanged,
}: {
  campaignId: string;
  onChanged?: () => void;
}) {
  const api = useApi();
  const [kbs, setKbs] = useState<KbView[]>([]);
  const [kbId, setKbId] = useState<string | null>(null);
  const [sources, setSources] = useState<KbSource[]>([]);
  const [newKbName, setNewKbName] = useState("");
  const [text, setText] = useState("");
  const [textSource, setTextSource] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSources = useCallback(
    async (id: string) => {
      setSources(await api.request<KbSource[]>(`/knowledge-bases/${id}/sources`));
    },
    [api],
  );

  const load = useCallback(async () => {
    const [list, brain] = await Promise.all([
      api.request<KbView[]>("/knowledge-bases"),
      api.request<BrainView>(`/campaigns/${campaignId}/brain`),
    ]);
    setKbs(list);
    setKbId(brain.knowledgeBaseId);
    if (brain.knowledgeBaseId) {
      await loadSources(brain.knowledgeBaseId);
    } else {
      setSources([]);
    }
  }, [api, campaignId, loadSources]);
  useEffect(() => {
    void load();
  }, [load]);

  const bind = async (id: string): Promise<void> => {
    setMsg(null);
    try {
      await api.request(`/campaigns/${campaignId}/brain`, {
        method: "PUT",
        body: { knowledgeBaseId: id || null },
      });
      await load();
      onChanged?.();
    } catch (err) {
      setMsg(errorMessage(err, "Could not link knowledge base"));
    }
  };

  const createKb = async (): Promise<void> => {
    if (!newKbName.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const kb = await api.request<{ id: string }>("/knowledge-bases", {
        method: "POST",
        body: { name: newKbName.trim() },
      });
      setNewKbName("");
      await bind(kb.id);
    } catch (err) {
      setMsg(errorMessage(err, "Could not create knowledge base"));
    } finally {
      setBusy(false);
    }
  };

  const runIngest = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    if (!kbId) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = (await fn()) as { chunks?: number };
      setMsg(`${label} — ${res?.chunks ?? 0} chunks added`);
      await loadSources(kbId);
    } catch (err) {
      setMsg(errorMessage(err, "Could not ingest"));
    } finally {
      setBusy(false);
    }
  };

  const ingestText = (): void => {
    if (!text.trim()) return;
    void runIngest("Text ingested", () =>
      api
        .request(`/knowledge-bases/${kbId}/ingest`, {
          method: "POST",
          body: { text, source: textSource.trim() || "pasted text" },
        })
        .then(() => {
          setText("");
          setTextSource("");
        }),
    );
  };

  const ingestUrl = (): void => {
    if (!url.trim()) return;
    void runIngest("URL ingested", () =>
      api
        .request(`/knowledge-bases/${kbId}/ingest`, { method: "POST", body: { url: url.trim() } })
        .then(() => setUrl("")),
    );
  };

  const ingestFile = (file: File): void => {
    const fd = new FormData();
    fd.append("file", file);
    void runIngest(`Uploaded ${file.name}`, () =>
      api.request(`/knowledge-bases/${kbId}/ingest-file`, { method: "POST", body: fd }),
    );
  };

  const removeSource = async (source: string): Promise<void> => {
    if (!kbId) return;
    setBusy(true);
    try {
      await api.request(`/knowledge-bases/${kbId}/sources?source=${encodeURIComponent(source)}`, {
        method: "DELETE",
      });
      await loadSources(kbId);
    } catch (err) {
      setMsg(errorMessage(err, "Could not delete source"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Knowledge base"
      description="What the AI is allowed to answer from. It answers ONLY from here — if the answer isn't present, it escalates to you instead of making something up."
    >
      <div className="space-y-4">
        <Field label="Linked knowledge base" hint="The AI grounds its replies in this knowledge base.">
          <div className="flex gap-2">
            <Select
              value={kbId ?? ""}
              onChange={(e) => void bind(e.target.value)}
              className="flex-1"
              disabled={busy}
            >
              <option value="">— None —</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name} ({kb.chunks} chunks)
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              placeholder="New knowledge base name…"
              className="flex-1"
            />
            <Button variant="outline" onClick={() => void createKb()} disabled={busy || !newKbName.trim()}>
              Create & link
            </Button>
          </div>
        </Field>

        {kbId ? (
          <>
            <div className="rounded-xl border bg-secondary/30 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Add knowledge</div>
              {/* paste text */}
              <div className="space-y-2">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste product details, FAQs, objection answers, pricing you're allowed to share…"
                  className="min-h-[90px]"
                />
                <div className="flex gap-2">
                  <Input
                    value={textSource}
                    onChange={(e) => setTextSource(e.target.value)}
                    placeholder="Label (optional), e.g. Pricing FAQ"
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={ingestText} disabled={busy || !text.trim()}>
                    <FileText className="size-4" />
                    Add text
                  </Button>
                </div>
              </div>
              {/* url + file */}
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-site.com/pricing"
                  className="min-w-[12rem] flex-1"
                />
                <Button variant="outline" onClick={ingestUrl} disabled={busy || !url.trim()}>
                  <Link2 className="size-4" />
                  Add URL
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="size-4" />
                  Upload doc
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.json,.html"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) ingestFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Supports pasted text, a URL, or a PDF / DOCX / TXT / MD / CSV / HTML file (max 10 MB).
              </p>
            </div>

            {/* ingested sources */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Ingested sources ({sources.length})
              </div>
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing ingested yet. Add text, a URL, or a document above.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {sources.map((s) => (
                    <li
                      key={s.source}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
                    >
                      <span className="truncate">{s.source}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{s.chunks} chunks</span>
                        <button
                          type="button"
                          onClick={() => void removeSource(s.source)}
                          disabled={busy}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${s.source}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Link or create a knowledge base to start adding the facts the AI may use.
          </p>
        )}

        {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
      </div>
    </Section>
  );
}

// --- guardrails ------------------------------------------------------------

function GuardrailsCard({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [neverDiscuss, setNeverDiscuss] = useState<string[]>([]);
  const [escalateOn, setEscalateOn] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const b = await api.request<BrainView>(`/campaigns/${campaignId}/brain`);
    setNeverDiscuss(b.guardrails?.never_discuss ?? []);
    setEscalateOn(b.guardrails?.escalate_on ?? []);
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      await api.request(`/campaigns/${campaignId}/brain`, {
        method: "PUT",
        body: { guardrails: { never_discuss: neverDiscuss, escalate_on: escalateOn } },
      });
      setMsg("Saved");
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Guardrails"
      description="Topics the AI must never discuss, and topics that must always be handed to a human."
    >
      <div className="space-y-4">
        <Field label="Never discuss" hint="The AI avoids these topics entirely.">
          <TagEditor
            values={neverDiscuss}
            onChange={setNeverDiscuss}
            placeholder="Type a topic and press Enter (e.g. competitor names)"
          />
        </Field>
        <Field
          label="Escalate to a human"
          hint="If the prospect raises any of these, the AI hands the thread to you instead of replying (pricing, legal, contracts…)."
        >
          <TagEditor
            values={escalateOn}
            onChange={setEscalateOn}
            placeholder="Type a topic and press Enter (e.g. pricing, legal)"
          />
        </Field>
      </div>
      <SaveRow onSave={() => void save()} saving={saving} msg={msg} />
    </Section>
  );
}

// --- voice (tone + few-shot samples) ---------------------------------------

function VoiceCard({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [tone, setTone] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const b = await api.request<BrainView>(`/campaigns/${campaignId}/brain`);
    setTone(b.voice?.tone ?? "");
    setSamples(b.voice?.samples ?? []);
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      const cleaned = samples.map((s) => s.trim()).filter(Boolean).slice(0, 10);
      await api.request(`/campaigns/${campaignId}/brain`, {
        method: "PUT",
        body: { voice: { tone, samples: cleaned } },
      });
      setSamples(cleaned);
      setMsg("Saved");
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Voice" description="How the AI sounds, and a few example replies it should imitate.">
      <div className="space-y-4">
        <Field label="Voice / tone" hint="How replies should sound.">
          <Input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="e.g. warm, concise, peer-to-peer; never salesy"
          />
        </Field>
        <Field
          label="Example replies (optional)"
          hint="Paste a few real replies in your voice — the AI uses them as few-shot examples. Up to 10."
        >
          <SamplesEditor values={samples} onChange={setSamples} />
        </Field>
      </div>
      <SaveRow onSave={() => void save()} saving={saving} msg={msg} />
    </Section>
  );
}

// --- autonomy + conversation limits ----------------------------------------

function AutonomyCard({
  campaignId,
  refreshKey,
  onChanged,
}: {
  campaignId: string;
  /** Bumped when another card saves; re-syncs the cross-card KB flag below. */
  refreshKey: number;
  onChanged?: () => void;
}) {
  const api = useApi();
  const [mode, setMode] = useState<Autonomy["mode"]>("approve_all");
  const [threshold, setThreshold] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [cooldown, setCooldown] = useState("");
  const [hasKb, setHasKb] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const b = await api.request<BrainView>(`/campaigns/${campaignId}/brain`);
    setMode(b.autonomy?.mode ?? "approve_all");
    setThreshold(b.autonomy?.confidence_threshold != null ? String(b.autonomy.confidence_threshold) : "");
    setMaxTurns(b.limits?.max_ai_turns != null ? String(b.limits.max_ai_turns) : "");
    setCooldown(b.limits?.cooldown_minutes != null ? String(b.limits.cooldown_minutes) : "");
    setHasKb(Boolean(b.knowledgeBaseId));
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  // When the Knowledge card links/unlinks a KB (refreshKey bumps), re-sync ONLY
  // the hasKb flag so the "needs a knowledge base" warning reflects reality —
  // without clobbering in-progress edits to the mode/threshold fields.
  useEffect(() => {
    if (refreshKey === 0) return;
    let cancelled = false;
    api
      .request<BrainView>(`/campaigns/${campaignId}/brain`)
      .then((b) => {
        if (!cancelled) setHasKb(Boolean(b.knowledgeBaseId));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey, api, campaignId]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      const ct = toNum(threshold);
      const mt = toNum(maxTurns);
      const cd = toNum(cooldown);
      await api.request(`/campaigns/${campaignId}/brain`, {
        method: "PUT",
        body: {
          autonomy: { mode, ...(ct !== undefined ? { confidence_threshold: ct } : {}) },
          limits: {
            ...(mt !== undefined ? { max_ai_turns: Math.max(0, Math.floor(mt)) } : {}),
            ...(cd !== undefined ? { cooldown_minutes: Math.max(0, Math.floor(cd)) } : {}),
          },
        },
      });
      setMsg("Saved");
      // Reply mode gates launch (grounding) — refresh the parent's readiness banner.
      onChanged?.();
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const isAuto = mode !== "approve_all";
  const needsKbWarning = isAuto && !hasKb;

  return (
    <Section
      title="Autonomy & limits"
      description="How much the AI may send on its own, and the safety caps on every conversation."
    >
      <div className="space-y-4">
        <Field
          label="AI reply mode"
          hint="Balanced replies to normal conversation and answers it's sure of, and hands off hot leads (recommended). Manual keeps a human on every reply. Auto modes still escalate pricing/legal/buying and need a knowledge base for factual answers."
        >
          <Select value={mode} onChange={(e) => setMode(e.target.value as Autonomy["mode"])}>
            <option value="auto_easy_escalate_hard">
              Balanced — AI replies to normal chats + answers it&apos;s sure of, escalates hot leads (recommended)
            </option>
            <option value="approve_all">Manual review — AI drafts, you approve every reply</option>
            <option value="full_auto">Autopilot — AI replies to everything except hot leads</option>
          </Select>
        </Field>
        {needsKbWarning ? (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
            <span>
              Auto-reply modes need a linked knowledge base so replies stay grounded — link one above
              before launching, or the campaign won&apos;t start.
            </span>
          </p>
        ) : null}
        <Field
          label="Confidence threshold"
          hint="Factual answers only (Balanced mode) — the AI auto-sends an answer only when it's at least this confident (0–1); below it, the answer waits for approval. Conversational replies aren't gated by this. Default 0.6."
        >
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="0.7"
            disabled={!isAuto}
          />
        </Field>
        <Field
          label="Max AI turns per conversation"
          hint="After this many AI replies in one thread, the AI hands off to a human. Default 6."
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            placeholder="6"
          />
        </Field>
        <Field
          label="Per-contact cooldown (minutes)"
          hint="Minimum minutes between AI replies to the same contact. 0 = no cooldown."
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            placeholder="0"
          />
        </Field>
      </div>
      <SaveRow onSave={() => void save()} saving={saving} msg={msg} />
    </Section>
  );
}

// --- AI budget (daily spend cap + alert) -----------------------------------

function BudgetCard({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [cap, setCap] = useState(""); // daily_usd_cap; blank = uncapped
  const [alertPct, setAlertPct] = useState(""); // shown as 0–100 %
  const [usage, setUsage] = useState<BudgetUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, u] = await Promise.all([
      api.request<BrainView>(`/campaigns/${campaignId}/brain`),
      api.request<BudgetUsage>(`/campaigns/${campaignId}/budget`).catch(() => null),
    ]);
    setCap(b.budget?.daily_usd_cap != null ? String(b.budget.daily_usd_cap) : "");
    setAlertPct(b.budget?.alert_at_pct != null ? String(Math.round(b.budget.alert_at_pct * 100)) : "");
    setUsage(u);
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      const capNum = toNum(cap);
      const pctNum = toNum(alertPct);
      const budget: Budget = {
        daily_usd_cap: capNum !== undefined ? Math.max(0, capNum) : null,
        ...(pctNum !== undefined ? { alert_at_pct: Math.min(1, Math.max(0, pctNum / 100)) } : {}),
      };
      await api.request(`/campaigns/${campaignId}/brain`, { method: "PUT", body: { budget } });
      setMsg("Saved");
      await load();
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="AI budget"
      description="Cap daily AI spend per campaign. At the cap the AI stops auto-sending and drops to approval-only — it never silently overspends."
    >
      <div className="space-y-4">
        <Field label="Daily spend cap (USD)" hint="Leave blank for no cap.">
          <Input
            type="number"
            min={0}
            step={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            placeholder="No cap"
          />
        </Field>
        <Field label="Alert threshold (%)" hint="Warn once when spend reaches this % of the cap. Default 80%.">
          <Input
            type="number"
            min={0}
            max={100}
            step={5}
            value={alertPct}
            onChange={(e) => setAlertPct(e.target.value)}
            placeholder="80"
          />
        </Field>
        {usage ? (
          <div className="rounded-xl border bg-secondary/30 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Today&apos;s AI spend</span>
              <span className="font-medium">
                ${usage.usdUsed.toFixed(2)}
                {usage.cap != null ? ` of $${usage.cap.toFixed(2)}` : " (uncapped)"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{usage.tokensUsed.toLocaleString()} tokens</span>
              {usage.hardStopped ? (
                <span className="text-destructive">Cap reached — approval-only</span>
              ) : usage.softAlerted ? (
                <span className="text-warning-foreground">Alert threshold reached</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <SaveRow onSave={() => void save()} saving={saving} msg={msg} />
    </Section>
  );
}

// --- tab -------------------------------------------------------------------

export function ContextTab({
  campaignId,
  onChanged,
}: {
  campaignId: string;
  /** Fired when brain config changes so the parent's live launch/AI-off gate re-checks. */
  onChanged?: () => void;
}) {
  // Bumped after the Aim / Knowledge / Autonomy cards save so the "AI is off"
  // banner and the cross-card KB warning re-check; also refreshes the parent gate.
  const [version, setVersion] = useState(0);
  const bump = (): void => {
    setVersion((v) => v + 1);
    onChanged?.();
  };
  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner key={version} campaignId={campaignId} />
      <ObjectiveCard campaignId={campaignId} onChanged={bump} />
      <KnowledgeCard campaignId={campaignId} onChanged={bump} />
      <GuardrailsCard campaignId={campaignId} />
      <VoiceCard campaignId={campaignId} />
      <AutonomyCard campaignId={campaignId} refreshKey={version} onChanged={bump} />
      <BudgetCard campaignId={campaignId} />
    </div>
  );
}
