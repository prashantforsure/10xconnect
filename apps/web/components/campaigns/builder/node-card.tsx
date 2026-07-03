"use client";

import { isBodyConfigured } from "@10xconnect/core";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  Eye,
  GitBranch,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  Send,
  Tag,
  ThumbsUp,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

import { useBuilder } from "./context";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COMPOSER_MANAGED_KEYS, hasTextBody, isComposerType, readComposer } from "@/lib/campaigns/composer";
import type { GraphNode } from "@/lib/campaigns/graph";
import { nodeDef } from "@/lib/campaigns/nodes";
import { cn } from "@/lib/utils";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  send_connection_request: UserPlus,
  send_message: MessageSquare,
  send_voice_note: Mic,
  comment_last_post: MessageCircle,
  reply_comment: CornerDownRight,
  like_last_post: ThumbsUp,
  visit_profile: Eye,
  inmail: Mail,
  send_message_to_open_profile: Send,
  follow_lead: UserCheck,
  add_tag: Tag,
};

function iconFor(node: GraphNode): ComponentType<{ className?: string }> {
  if (node.kind === "condition") {
    return GitBranch;
  }
  return ICONS[node.type] ?? MessageSquare;
}

/** Parse a numeric field value, coercing blank/invalid to 0 (never NaN). */
function parseIntOr0(v: string): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Is a composer node missing its body/audio? (drives the "Action required" badge) */
function isMisconfigured(node: GraphNode): boolean {
  if (!isComposerType(node.type)) {
    return false;
  }
  const composer = readComposer(node.type, node.config);
  return hasTextBody(node.type)
    ? !isBodyConfigured(composer.body)
    : node.type === "send_voice_note" && !composer.audioRef.trim();
}

export function NodeCard({ node }: { node: GraphNode }) {
  const { running, counts, selectedId, remove, move, updateConfig, selectComposer } = useBuilder();
  const def = nodeDef(node.type);
  const composer = isComposerType(node.type);
  const isSelected = selectedId === node.id && composer;
  const count = counts[node.id] ?? 0;
  const misconfigured = isMisconfigured(node);
  const Icon = iconFor(node);
  const isCondition = node.kind === "condition";
  // Inline fields = config the composer DOESN'T own (e.g. reply_comment's postUrl).
  const inlineFields = (def?.fields ?? []).filter((f) => !COMPOSER_MANAGED_KEYS.has(f.key));

  return (
    <div
      className={cn(
        // Content stays editable while the campaign runs (composer + inline
        // fields); only STRUCTURE controls (move/delete) lock below.
        "seqnode group relative w-[340px] rounded-[14px] border bg-card px-3.5 py-3 text-left transition-colors",
        composer ? "cursor-pointer" : "",
        isSelected ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-[hsl(45_16%_25%)]",
      )}
      onClick={composer ? () => selectComposer(node.id) : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-[9px]",
            isCondition ? "bg-chart-4/15 text-chart-4" : "bg-primary/15 text-primary",
          )}
        >
          <Icon className="size-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-foreground">{def?.label ?? node.type}</div>
          <div className="mt-0.5 truncate text-[11.5px]">
            {misconfigured ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <AlertTriangle className="size-3" />
                Action required
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Users className="size-3" />
                {count} {count === 1 ? "lead" : "leads"}
              </span>
            )}
          </div>
        </div>

        {!running ? (
          <div
            className="seqacts flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="ghost" size="icon" className="size-7" onClick={() => move(node.id, -1)} aria-label="Move up">
              <ArrowUp className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => move(node.id, 1)} aria-label="Move down">
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={() => remove(node.id)}
              aria-label="Delete step"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {inlineFields.length > 0 ? (
        <div className="mt-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
          {inlineFields.map((f) => (
            <div key={f.key} className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-muted-foreground">{f.label}</label>
                {f.maxChars ? (
                  <span
                    className={
                      String(node.config[f.key] ?? "").length > f.maxChars
                        ? "text-[10px] font-medium tabular-nums text-destructive"
                        : "text-[10px] tabular-nums text-muted-foreground"
                    }
                  >
                    {String(node.config[f.key] ?? "").length}/{f.maxChars}
                  </span>
                ) : null}
              </div>
              {f.type === "textarea" ? (
                <Textarea
                  value={String(node.config[f.key] ?? "")}
                  onChange={(e) => updateConfig(node.id, f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="min-h-[60px] text-xs"
                />
              ) : (
                <Input
                  type={f.type === "number" ? "number" : "text"}
                  value={String(node.config[f.key] ?? "")}
                  onChange={(e) =>
                    updateConfig(
                      node.id,
                      f.key,
                      // Guard NaN: an empty number input yields "" → Number("") is
                      // NaN, which would serialize to null and break config reads.
                      f.type === "number" ? parseIntOr0(e.target.value) : e.target.value,
                    )
                  }
                  placeholder={f.placeholder}
                  className="h-8 text-xs"
                />
              )}
              {f.help ? <p className="text-[10px] text-muted-foreground">{f.help}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
