"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export interface PreviewSample {
  leadId: string;
  name: string;
  vars: Record<string, string>;
}

export interface PreviewItem {
  name: string;
  text: string;
}

export function PreviewModal({
  open,
  onClose,
  items,
  varietyWarning,
  loading,
  onRegenerate,
}: {
  open: boolean;
  onClose: () => void;
  items: PreviewItem[];
  varietyWarning: string | null;
  loading: boolean;
  onRegenerate: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview"
      description="Rendered for sample leads — exactly what the engine will send."
      className="max-w-2xl"
    >
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onRegenerate} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            Regenerate
          </Button>
        </div>

        {varietyWarning ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{varietyWarning}</span>
          </div>
        ) : null}

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Generating…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No sample leads available.</p>
        ) : (
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border bg-card p-3 shadow-soft">
                <div className="mb-2 flex items-center gap-2">
                  <Avatar name={it.name} size="sm" />
                  <span className="text-sm font-medium">{it.name}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {it.text || <span className="text-muted-foreground">(empty message)</span>}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          AI segments are generated per lead; identical-looking output across leads triggers a variety warning.
        </p>
      </div>
    </Modal>
  );
}
