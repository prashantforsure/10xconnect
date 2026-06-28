"use client";

import type { CampaignBlueprint, GenNode } from "@10xconnect/core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { linearChain, toSavePayload } from "@/lib/campaigns/graph";
import { nodeLabel } from "@/lib/campaigns/nodes";

type Tone = "gentle" | "balanced" | "aggressive";
type Phase = "intake" | "questions" | "review";

interface Intake {
  offer: string;
  audience: string;
  goal: string;
  tone: Tone;
  instructions?: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

const AUTONOMY_LABEL: Record<string, string> = {
  approve_all: "Approve all (you approve every reply)",
  auto_easy_escalate_hard: "Auto easy, escalate hard",
  full_auto: "Full auto",
};

/** A handful of the most meaningful caps to preview (full set is on the Settings tab). */
const PREVIEW_CAPS: { key: string; label: string }[] = [
  { key: "connection_request", label: "Connections/day" },
  { key: "message", label: "Messages/day" },
  { key: "visit_profile", label: "Profile visits/day" },
];

/**
 * "Build with AI" (E4 / Phase 6): a short intake → a FULL campaign blueprint
 * (objective + guardrails + voice + autonomy + cadence + a message-skeleton graph
 * + a knowledge-base seed). Under-specified intake first asks 1–2 clarifying
 * questions. On "Use this campaign" the WHOLE blueprint is applied — the graph
 * lands on the canvas and the brain/context fields are persisted, so the Context
 * tab is already populated. Nothing launches automatically.
 */
export function BuildWithAiModal({
  open,
  onClose,
  campaignId,
  onApply,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  /** Loads the generated graph onto the builder canvas. */
  onApply: (nodes: GenNode[]) => void;
  /** Called after the brain/cadence are persisted, so the parent can refresh. */
  onApplied?: () => void;
}) {
  const api = useApi();
  const [phase, setPhase] = useState<Phase>("intake");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("book intro calls");
  const [tone, setTone] = useState<Tone>("balanced");
  const [instructions, setInstructions] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [blueprint, setBlueprint] = useState<CampaignBlueprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setPhase("intake");
    setQuestions([]);
    setAnswers([]);
    setBlueprint(null);
    setError(null);
    setBusy(false);
    onClose();
  };

  const baseIntake = (): Intake => ({
    offer,
    audience,
    goal,
    tone,
    instructions: instructions.trim() || undefined,
  });

  // generate (full). A thin intake returns 1–2 clarifying questions first.
  const generate = async (intake: Intake, skipClarify: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.request<{ blueprint: CampaignBlueprint } | { questions: string[] }>(
        `/campaigns/${campaignId}/generate`,
        { method: "POST", body: { intake, full: true, skipClarify } },
      );
      if ("questions" in res && res.questions.length > 0) {
        setQuestions(res.questions);
        setAnswers(res.questions.map(() => ""));
        setPhase("questions");
      } else if ("blueprint" in res) {
        setBlueprint(res.blueprint);
        setPhase("review");
      }
    } catch (err) {
      setError(errorMessage(err, "Could not generate the campaign"));
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = (): void => {
    if (!offer.trim() || !audience.trim() || !goal.trim()) {
      return;
    }
    void generate(baseIntake(), false);
  };

  // Fold the clarifying answers into the intake instructions, then generate.
  // (Clamp to the intake.instructions max so a long Q&A can't 400 the request.)
  const onAnswered = (): void => {
    const qa = questions
      .map((q, i) => (answers[i]?.trim() ? `Q: ${q} A: ${answers[i].trim()}` : null))
      .filter(Boolean)
      .join("\n");
    const enriched = [instructions.trim(), qa].filter(Boolean).join("\n").slice(0, 1200);
    void generate({ ...baseIntake(), instructions: enriched || undefined }, true);
  };

  // Apply the WHOLE blueprint to the draft campaign: the brain (objective/
  // guardrails/voice/autonomy), the cadence caps, and the sequence graph. Each is
  // a full-replace PUT (safe to retry). The graph is persisted directly here so
  // launch readiness reflects it immediately (the canvas also autosaves it). The
  // knowledge base is intentionally NOT auto-created — the user supplies the real
  // facts (the seed sections are shown above as guidance); launch is gated on it.
  const apply = async (): Promise<void> => {
    if (!blueprint) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.request(`/campaigns/${campaignId}/brain`, {
        method: "PUT",
        body: {
          objective: {
            goal: blueprint.objective.goal,
            offer: offer.trim() || undefined,
            success_criteria: blueprint.objective.success_criteria,
            icp: blueprint.objective.icp,
            cta: blueprint.objective.cta,
          },
          guardrails: blueprint.guardrails,
          voice: { tone: blueprint.voice.tone },
          autonomy: blueprint.autonomy,
        },
      });
      await api.request(`/campaigns/${campaignId}/settings/frequency`, {
        method: "PUT",
        body: { caps: blueprint.cadence.caps },
      });
      const graph = linearChain(
        blueprint.graph.map((n) => ({ kind: n.kind, type: n.type, config: n.config })),
      );
      await api.request(`/campaigns/${campaignId}/sequence`, {
        method: "PUT",
        body: { nodes: toSavePayload(graph) },
      });
      onApply(blueprint.graph); // show the generated graph on the canvas
      onApplied?.(); // refresh the AI-off banner + launch readiness from fresh state
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not apply the campaign — your inputs are kept; try again."));
    } finally {
      setBusy(false);
    }
  };

  const caps = (blueprint?.cadence.caps ?? {}) as Record<string, number>;
  const description =
    phase === "questions"
      ? "A couple of quick questions so the campaign isn't built on guesses."
      : phase === "review"
        ? "Review the generated campaign. Applying it fills the builder and the Context tab; you then add your real facts and run it."
        : "Describe your outreach and we'll draft a full campaign — sequence, objective, guardrails, voice, and a knowledge-base outline. You review it, add your real facts, and run it. Nothing sends automatically.";

  return (
    <Modal open={open} onClose={close} title="Build with AI" description={description} className="max-w-xl">
      {phase === "intake" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="g-offer">What do you offer?</Label>
            <Input id="g-offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. fractional RevOps for seed-stage SaaS" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-audience">Who are you targeting (ICP)?</Label>
            <Input id="g-audience" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. seed-stage B2B SaaS founders" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-goal">Goal</Label>
              <Input id="g-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="book intro calls" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-tone">Tone</Label>
              <Select id="g-tone" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                <option value="gentle">Gentle</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-extra">Anything else? (optional)</Label>
            <Textarea
              id="g-extra"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[70px]"
              placeholder="e.g. include a voice note; keep it very low-pressure"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onGenerate} disabled={busy || !offer.trim() || !audience.trim() || !goal.trim()}>
              {busy ? "Generating…" : "Generate campaign"}
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "questions" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A couple of quick questions so the campaign isn&apos;t built on guesses:
          </p>
          {questions.map((q, i) => (
            <div key={i} className="space-y-1.5">
              <Label htmlFor={`g-q-${i}`}>{q}</Label>
              <Textarea
                id={`g-q-${i}`}
                value={answers[i] ?? ""}
                onChange={(e) => setAnswers((a) => a.map((v, idx) => (idx === i ? e.target.value : v)))}
                className="min-h-[60px]"
                placeholder="Your answer…"
              />
            </div>
          ))}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPhase("intake")} disabled={busy}>
              Back
            </Button>
            <Button onClick={onAnswered} disabled={busy || answers.every((a) => !a.trim())}>
              {busy ? "Generating…" : "Generate campaign"}
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "review" && blueprint ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <ReviewBlock title="Objective">
              <ReviewLine label="Aim" value={blueprint.objective.goal} />
              <ReviewLine label="Success" value={blueprint.objective.success_criteria} />
              <ReviewLine label="ICP" value={blueprint.objective.icp} />
              <ReviewLine label="CTA" value={blueprint.objective.cta} />
            </ReviewBlock>

            <ReviewBlock title="Voice & autonomy">
              <ReviewLine label="Voice" value={blueprint.voice.tone} />
              <ReviewLine label="Autonomy" value={AUTONOMY_LABEL[blueprint.autonomy.mode] ?? blueprint.autonomy.mode} />
            </ReviewBlock>

            {blueprint.guardrails.escalate_on.length > 0 ? (
              <ReviewBlock title="Guardrails — escalate to a human">
                <ChipRow values={blueprint.guardrails.escalate_on} />
              </ReviewBlock>
            ) : null}

            <ReviewBlock title="Cadence (safe daily caps)">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {PREVIEW_CAPS.map((c) => (
                  <span key={c.key} className="text-muted-foreground">
                    {c.label}: <span className="font-medium text-foreground">{caps[c.key] ?? "—"}</span>
                  </span>
                ))}
              </div>
            </ReviewBlock>

            <ReviewBlock title={`Sequence (${blueprint.graph.length} steps)`}>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
                {blueprint.graph.map((n, i) => (
                  <li key={i}>{nodeLabel(n.type)}</li>
                ))}
              </ol>
            </ReviewBlock>

            <ReviewBlock title="Knowledge base — you add the real facts">
              <p className="text-xs text-muted-foreground">{blueprint.knowledgeSeed.name}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {blueprint.knowledgeSeed.sections.map((s, i) => (
                  <li key={i}>{s.title}</li>
                ))}
              </ul>
            </ReviewBlock>

            <ReviewBlock title="Before launch you'll add">
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {blueprint.requiredInputs
                  .filter((r) => r.required)
                  .map((r) => (
                    <li key={r.key}>• {r.label}</li>
                  ))}
              </ul>
            </ReviewBlock>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPhase("intake")} disabled={busy}>
              Start over
            </Button>
            <Button onClick={() => void apply()} disabled={busy}>
              {busy ? "Applying…" : "Use this campaign"}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-secondary/30 p-3">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  if (!value) {
    return null;
  }
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}:</span> {value}
    </p>
  );
}

function ChipRow({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span key={v} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
          {v}
        </span>
      ))}
    </div>
  );
}
