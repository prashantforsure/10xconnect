"use client";

import { Info, Mic, Sparkles } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_MS = 30_000;

/**
 * Voice-note config (CLAUDE.md §6/§7): recorded vs AI-clone mode, a ≤30s length
 * meter, helper tips, and the audio reference. Native voice notes feel human only
 * when they're short and natural.
 */
export function VoiceNoteFields({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (partial: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const mode = config.voiceMode === "ai_clone" ? "ai_clone" : "recorded";
  const audioRef = typeof config.audioRef === "string" ? config.audioRef : "";
  const durationMs = typeof config.durationMs === "number" ? config.durationMs : 0;
  const seconds = Math.round(durationMs / 1000);
  const over = durationMs > MAX_MS;
  const pct = Math.min(100, (durationMs / MAX_MS) * 100);

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border bg-secondary p-1 text-sm">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ voiceMode: "recorded" })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
            mode === "recorded" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
          )}
        >
          <Mic className="size-4" />
          Recorded
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ voiceMode: "ai_clone" })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
            mode === "ai_clone" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
          )}
        >
          <Sparkles className="size-4" />
          AI clone
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio reference</label>
        <Input
          value={audioRef}
          onChange={(e) => onChange({ audioRef: e.target.value })}
          placeholder={mode === "ai_clone" ? "voice profile id (Settings → Voice cloner)" : "recorded clip ref"}
          disabled={disabled}
        />
      </div>

      {/* ≤30s length meter */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Length</span>
          <span className={over ? "font-medium text-destructive" : "text-muted-foreground"}>
            {seconds}s / 30s
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-success")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={45}
          value={seconds}
          disabled={disabled}
          onChange={(e) => onChange({ durationMs: Number(e.target.value) * 1000 })}
          className="w-full accent-primary"
          aria-label="Voice note length (seconds)"
        />
        {over ? (
          <p className="text-[11px] text-destructive">Keep it under 30s — long notes get skipped.</p>
        ) : null}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Smile while recording — it carries in your voice. Sound natural, keep it under 30s, and let it
        feel off-the-cuff.
      </p>
    </div>
  );
}
