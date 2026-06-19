"use client";

import type { GenNode } from "@10xconnect/core";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";

type Tone = "gentle" | "balanced" | "aggressive";

/**
 * "Build with AI" (E4): a short intake → the AI returns a structured, editable
 * sequence on the canvas. Never auto-launches — the user reviews, edits, then runs.
 */
export function BuildWithAiModal({
  open,
  onClose,
  campaignId,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onApply: (nodes: GenNode[]) => void;
}) {
  const api = useApi();
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("book intro calls");
  const [tone, setTone] = useState<Tone>("balanced");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!offer.trim() || !audience.trim() || !goal.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.request<{ nodes: GenNode[] }>(`/campaigns/${campaignId}/generate`, {
        method: "POST",
        body: { intake: { offer, audience, goal, tone, instructions: instructions || undefined } },
      });
      onApply(res.nodes);
      onClose();
    } catch (err) {
      setError((err as ApiError)?.message ?? "Could not generate the campaign");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Build with AI"
      description="Describe your outreach and we'll draft an editable sequence. You review and run it — nothing sends automatically."
      className="max-w-xl"
    >
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !offer.trim() || !audience.trim()}>
            {busy ? "Generating…" : "Generate sequence"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
