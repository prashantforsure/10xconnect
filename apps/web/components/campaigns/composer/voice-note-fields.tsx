"use client";

import { Info, Mic, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const MAX_MS = 30_000;
const BUCKET = "campaign-media";

/**
 * Voice-note config (CLAUDE.md §6/§7): recorded vs AI-clone mode, a ≤30s length
 * meter, helper tips, and the audio reference. In Recorded mode you record the
 * note ONCE in the browser — the same clip is sent to every lead. The clip is
 * uploaded to the private campaign-media bucket and its path stored as audioRef.
 */
export function VoiceNoteFields({
  config,
  onChange,
  disabled,
  workspaceId,
  campaignId,
}: {
  config: Record<string, unknown>;
  onChange: (partial: Record<string, unknown>) => void;
  disabled?: boolean;
  workspaceId: string;
  campaignId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const mode = config.voiceMode === "ai_clone" ? "ai_clone" : "recorded";
  const audioRef = typeof config.audioRef === "string" ? config.audioRef : "";
  const durationMs = typeof config.durationMs === "number" ? config.durationMs : 0;
  const seconds = Math.round(durationMs / 1000);
  const over = durationMs > MAX_MS;
  const pct = Math.min(100, (durationMs / MAX_MS) * 100);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef<number>(0);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live elapsed timer while recording (auto-stops at 30s).
  useEffect(() => {
    if (!recording) {
      return;
    }
    const t = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_MS) {
        stop();
      }
    }, 100);
    return () => clearInterval(t);
  }, [recording]);

  const start = async (): Promise<void> => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const ms = Date.now() - startedAt.current;
        void upload(new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }), ms);
      };
      recorder.current = mr;
      startedAt.current = Date.now();
      mr.start();
      setRecording(true);
      setElapsed(0);
    } catch {
      setError("Microphone access was blocked. Allow it, or paste an audio ref below.");
    }
  };

  const stop = (): void => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.stop();
    }
    setRecording(false);
  };

  const upload = async (blob: Blob, ms: number): Promise<void> => {
    setUploading(true);
    setError(null);
    try {
      const path = `${workspaceId}/${campaignId}/${crypto.randomUUID()}-voice.webm`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { upsert: false, contentType: blob.type || "audio/webm" });
      if (upErr) {
        throw upErr;
      }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      setPreviewUrl(signed?.signedUrl ?? null);
      onChange({ audioRef: path, durationMs: Math.min(ms, 45_000), voiceMode: "recorded" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the recording");
    } finally {
      setUploading(false);
    }
  };

  const liveSeconds = Math.round(elapsed / 1000);

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

      {mode === "recorded" ? (
        <div className="space-y-2 rounded-lg border bg-secondary/30 p-3">
          <div className="flex items-center gap-2">
            {recording ? (
              <Button type="button" variant="destructive" size="sm" onClick={stop} disabled={disabled}>
                <Square className="size-4" />
                Stop · {liveSeconds}s
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => void start()} disabled={disabled || uploading}>
                <Mic className="size-4" />
                {uploading ? "Saving…" : audioRef ? "Re-record" : "Record"}
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">Record once — the same note is sent to every lead.</span>
          </div>
          {previewUrl ? <audio controls src={previewUrl} className="h-8 w-full" /> : null}
          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio reference</label>
        <Input
          value={audioRef}
          onChange={(e) => onChange({ audioRef: e.target.value })}
          placeholder={mode === "ai_clone" ? "voice profile id (Settings → Voice cloner)" : "recorded clip ref (auto-filled on record)"}
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
