"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";

interface DuplicateResult {
  campaignId: string;
  nodeCount: number;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

/**
 * Duplicate a campaign's STRUCTURE (graph + brain + cadence + account binding) into a
 * fresh 0-contact draft — the seam for A/B avatar testing: clone, enroll a different
 * list, run both, compare. Unlike a workflow template it keeps the account/KB/voice
 * bindings (same persona, different audience).
 */
export function DuplicateCampaignModal({
  open,
  onClose,
  campaignId,
  defaultName,
  onDuplicated,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  defaultName: string;
  onDuplicated: (newCampaignId: string) => void;
}) {
  const api = useApi();
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
      setBusy(false);
    }
  }, [open, defaultName]);

  const duplicate = async (): Promise<void> => {
    if (!name.trim() || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.request<DuplicateResult>(`/campaigns/${campaignId}/duplicate`, {
        method: "POST",
        body: { name: name.trim() },
      });
      onDuplicated(res.campaignId);
    } catch (err) {
      setError(errorMessage(err, "Could not duplicate campaign"));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicate campaign"
      description="Clones the sequence, AI brain, cadence, and sending account into a fresh draft with 0 contacts — enroll a different list to A/B test the same persona on a new audience."
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dup-name">New campaign name</Label>
          <Input
            id="dup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Founder outreach (copy)"
            autoFocus
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void duplicate()} disabled={!name.trim() || busy}>
            {busy ? "Duplicating…" : "Duplicate"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
