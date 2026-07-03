"use client";

import { aboveTheFold, lintMessageBody, type MessageBody, renderMessageBody } from "@10xconnect/core";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Non-blocking sales-guard linter + above-the-fold preview (CLAUDE.md §2/§6). All
 * advisory — it never prevents saving or launching. Lints the rendered text (AI
 * shown as a placeholder, variables resolved to fallback/skip). When the node
 * type has a LinkedIn character cap, a live estimated counter rides along
 * (estimated because AI chips render as a short stub).
 */
export function GuardrailsPanel({ body, charLimit }: { body: MessageBody; charLimit?: number }) {
  const text = renderMessageBody(body, {}, { renderAi: () => "[AI line]" });
  if (!text.trim()) {
    return null;
  }
  // Shared pure pipeline (also unit-tested) — keeps the in-composer lint identical
  // to what tests assert.
  const findings = lintMessageBody(body, { firstTouch: true, ...(charLimit ? { charLimit } : {}) });
  const fold = aboveTheFold(text);
  const nearLimit = charLimit ? text.length >= charLimit * 0.9 : false;
  const overLimit = charLimit ? text.length > charLimit : false;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Above the fold
        </div>
        {charLimit ? (
          <span
            className={cn(
              "text-[11px] tabular-nums",
              overLimit ? "font-medium text-destructive" : nearLimit ? "text-warning" : "text-muted-foreground",
            )}
          >
            ~{text.length.toLocaleString()} / {charLimit.toLocaleString()}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-foreground">
        {fold.visible}
        {fold.truncated ? <span className="text-muted-foreground"> …more</span> : null}
      </p>
      {findings.length > 0 ? (
        <ul className="space-y-1 pt-1">
          {findings.map((f) => (
            <li key={f.id} className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {f.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 pt-1 text-xs text-success">
          <CheckCircle2 className="size-3.5" />
          Conversational — no salesy smells.
        </p>
      )}
    </div>
  );
}
