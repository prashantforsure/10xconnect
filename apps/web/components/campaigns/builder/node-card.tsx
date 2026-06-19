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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COMPOSER_MANAGED_KEYS, hasTextBody, isComposerType, readComposer } from "@/lib/campaigns/composer";
import type { GraphNode } from "@/lib/campaigns/graph";
import { nodeDef } from "@/lib/campaigns/nodes";

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
      className={
        "surface-card w-[320px] p-3.5 text-left transition-shadow" +
        (composer ? " cursor-pointer" : "") +
        (isSelected ? " ring-2 ring-primary/40" : "")
      }
      onClick={composer && !running ? () => selectComposer(node.id) : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={
            "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl " +
            (isCondition ? "bg-tint-amber text-[hsl(35_85%_38%)]" : "bg-tint-violet text-[hsl(255_60%_55%)]")
          }
        >
          <Icon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{def?.label ?? node.type}</div>
            <span
              className={
                "ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                (isCondition
                  ? "bg-tint-amber text-[hsl(35_85%_35%)]"
                  : "bg-tint-violet text-[hsl(255_55%_52%)]")
              }
            >
              {isCondition ? "Logic" : "Action"}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Users className="size-3" />
            {count} {count === 1 ? "lead" : "leads"}
            {misconfigured ? (
              <Badge variant="warning" className="ml-1">
                <AlertTriangle className="size-3" />
                Action required
              </Badge>
            ) : null}
          </div>

          {inlineFields.length > 0 ? (
            <div className="mt-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
              {inlineFields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">{f.label}</label>
                  {f.type === "textarea" ? (
                    <Textarea
                      value={String(node.config[f.key] ?? "")}
                      onChange={(e) => updateConfig(node.id, f.key, e.target.value)}
                      placeholder={f.placeholder}
                      disabled={running}
                      className="min-h-[60px] text-xs"
                    />
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : "text"}
                      value={String(node.config[f.key] ?? "")}
                      onChange={(e) =>
                        updateConfig(node.id, f.key, f.type === "number" ? Number(e.target.value) : e.target.value)
                      }
                      placeholder={f.placeholder}
                      disabled={running}
                      className="h-8 text-xs"
                    />
                  )}
                  {f.help ? <p className="text-[10px] text-muted-foreground">{f.help}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {composer ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {isSelected ? "Editing in the composer →" : "Click to open the composer"}
            </p>
          ) : null}
        </div>

        {!running ? (
          <div className="flex shrink-0 flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="size-6" onClick={() => move(node.id, -1)} aria-label="Move up">
              <ArrowUp className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={() => move(node.id, 1)} aria-label="Move down">
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-destructive"
              onClick={() => remove(node.id)}
              aria-label="Delete step"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
