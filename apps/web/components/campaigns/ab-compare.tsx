"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { formatUsd } from "@/lib/campaigns/unit-economics";
import { cn } from "@/lib/utils";

interface CampaignChoice {
  id: string;
  name: string;
  status: string;
}

// Mirrors the engine CampaignOutcome returned by POST /campaigns/ab-compare.
interface CampaignOutcome {
  campaignId: string;
  name: string;
  enrolled: number;
  sent: number;
  accepted: number;
  replied: number;
  acceptRate: number;
  replyRate: number;
  spendUsd: number;
  conversations: number;
  bookedMeetings: number;
  costPerConversationUsd: number | null;
  costPerBookedMeetingUsd: number | null;
}

const MAX_COMPARE = 10;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

interface MetricRow {
  label: string;
  /** Numeric value to compare across columns (null = no data, never wins). */
  value: (o: CampaignOutcome) => number | null;
  /** Display string for the cell. */
  render: (o: CampaignOutcome) => string;
  /** Which direction wins: higher is better, or lower (for costs). */
  best?: "max" | "min";
}

const ROWS: MetricRow[] = [
  { label: "Enrolled", value: (o) => o.enrolled, render: (o) => o.enrolled.toLocaleString() },
  { label: "Sent", value: (o) => o.sent, render: (o) => o.sent.toLocaleString() },
  {
    label: "Accepted",
    value: (o) => o.acceptRate,
    render: (o) => `${o.accepted.toLocaleString()} · ${o.acceptRate}%`,
    best: "max",
  },
  {
    label: "Replied",
    value: (o) => o.replyRate,
    render: (o) => `${o.replied.toLocaleString()} · ${o.replyRate}%`,
    best: "max",
  },
  { label: "Conversations", value: (o) => o.conversations, render: (o) => o.conversations.toLocaleString() },
  {
    label: "Booked meetings",
    value: (o) => o.bookedMeetings,
    render: (o) => o.bookedMeetings.toLocaleString(),
    best: "max",
  },
  { label: "AI spend", value: () => null, render: (o) => formatUsd(o.spendUsd) },
  {
    label: "Cost / conversation",
    value: (o) => o.costPerConversationUsd,
    render: (o) => formatUsd(o.costPerConversationUsd),
    best: "min",
  },
  {
    label: "Cost / booked meeting",
    value: (o) => o.costPerBookedMeetingUsd,
    render: (o) => formatUsd(o.costPerBookedMeetingUsd),
    best: "min",
  },
];

/** The winning value for a row across outcomes (null when nothing is comparable). */
function winningValue(row: MetricRow, outcomes: CampaignOutcome[]): number | null {
  if (!row.best) {
    return null;
  }
  const vals = outcomes.map(row.value).filter((v): v is number => v != null);
  if (vals.length < 2) {
    return null; // need ≥2 real values to call a winner
  }
  const best = row.best === "max" ? Math.max(...vals) : Math.min(...vals);
  // Don't crown a winner when every column ties.
  return vals.every((v) => v === best) ? null : best;
}

/**
 * A/B compare: pick two (or more) campaigns and read their funnel + unit economics
 * side by side — the readout after a duplicate + list swap. The headline is
 * cost-per-booked-meeting: which avatar books meetings cheaper.
 */
export function AbCompareModal({
  open,
  onClose,
  campaigns,
}: {
  open: boolean;
  onClose: () => void;
  campaigns: CampaignChoice[];
}) {
  const api = useApi();
  const [selected, setSelected] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<CampaignOutcome[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setOutcomes(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      return prev.length >= MAX_COMPARE ? prev : [...prev, id];
    });
  };

  const compare = async (): Promise<void> => {
    if (selected.length < 2 || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<CampaignOutcome[]>("/campaigns/ab-compare", {
        method: "POST",
        body: { campaignIds: selected },
      });
      // Preserve selection order so columns read left-to-right as chosen.
      setOutcomes(selected.map((id) => res.find((o) => o.campaignId === id)).filter((o): o is CampaignOutcome => !!o));
    } catch (err) {
      setError(errorMessage(err, "Could not compare campaigns"));
    } finally {
      setLoading(false);
    }
  };

  const winners = useMemo(
    () => (outcomes ? ROWS.map((row) => winningValue(row, outcomes)) : []),
    [outcomes],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compare campaigns"
      description={
        outcomes
          ? "Funnel + unit economics side by side. The lowest cost per booked meeting wins."
          : "Pick two or more campaigns (e.g. a campaign and its duplicate with a swapped list) to compare A/B."
      }
      className="max-w-3xl"
    >
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}

      {outcomes ? (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[28rem] overflow-hidden rounded-xl border text-sm"
              style={{ gridTemplateColumns: `minmax(9.5rem,1.3fr) repeat(${outcomes.length}, minmax(8rem,1fr))` }}
            >
              {/* Header row */}
              <div className="border-b bg-secondary/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground">
                Metric
              </div>
              {outcomes.map((o) => (
                <div
                  key={o.campaignId}
                  className="truncate border-b border-l bg-secondary/40 px-3 py-2.5 font-display font-semibold"
                  title={o.name}
                >
                  {o.name || "Untitled"}
                </div>
              ))}

              {/* Metric rows */}
              {ROWS.map((row, ri) => (
                <RowCells key={row.label} row={row} outcomes={outcomes} winner={winners[ri]} lastRow={ri === ROWS.length - 1} />
              ))}
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setOutcomes(null)}>
              Back
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {campaigns.map((c) => {
              const on = selected.includes(c.id);
              const atCap = !on && selected.length >= MAX_COMPARE;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    disabled={atCap}
                    aria-pressed={on}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                      on ? "border-primary bg-primary/5" : "bg-card hover:border-primary/40",
                      atCap && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on ? <Check className="size-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="text-xs capitalize text-muted-foreground">{c.status}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {selected.length} selected{selected.length < 2 ? " · pick at least 2" : ""}
            </span>
            <Button onClick={() => void compare()} disabled={selected.length < 2 || loading}>
              {loading ? "Comparing…" : `Compare ${selected.length || ""}`.trim()}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RowCells({
  row,
  outcomes,
  winner,
  lastRow,
}: {
  row: MetricRow;
  outcomes: CampaignOutcome[];
  winner: number | null;
  lastRow: boolean;
}) {
  const border = lastRow ? "" : "border-b";
  return (
    <>
      <div className={cn("px-3 py-2.5 text-muted-foreground", border)}>{row.label}</div>
      {outcomes.map((o) => {
        const isWinner = winner != null && row.value(o) === winner;
        return (
          <div
            key={o.campaignId}
            className={cn(
              "border-l px-3 py-2.5 font-medium tabular-nums",
              border,
              isWinner && "bg-success/10 font-bold text-success",
            )}
          >
            {row.render(o)}
          </div>
        );
      })}
    </>
  );
}
