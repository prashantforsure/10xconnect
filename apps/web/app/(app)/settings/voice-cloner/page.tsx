import { Mic, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function VoiceClonerSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Voice cloner</h1>
        <p className="text-sm text-muted-foreground">
          Send native LinkedIn voice notes — recorded, uploaded, or AI-cloned per prospect.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="surface-card p-6">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mic className="size-5" />
          </span>
          <h2 className="mt-4 font-display text-base font-semibold">Record / upload a voice note</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a recorded or uploaded clip to a <span className="font-medium">Voice note</span> step in
            the campaign builder (≤30s recommended). It sends as a native LinkedIn voice note via the
            adapter.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" disabled>
              <Mic className="size-4" /> Record
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Upload className="size-4" /> Upload
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Audio storage wiring (Supabase Storage) is the next step.
          </p>
        </div>

        <div className="surface-card p-6">
          <span className="flex size-11 items-center justify-center rounded-xl bg-tint-violet text-[hsl(265_45%_45%)]">
            <Sparkles className="size-5" />
          </span>
          <h2 className="mt-4 font-display text-base font-semibold">AI voice clone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Train a clone of your voice and generate a unique note per prospect with variables.
          </p>
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            Requires a TTS / voice-clone provider key (<code>TTS_API_KEY</code>). Add one to enable AI
            voice cloning. Note: native voice notes also require a transport that supports them — the
            current Unipile API does not expose a voice-note endpoint, so voice sends work on the mock
            adapter today.
          </div>
        </div>
      </div>
    </div>
  );
}
