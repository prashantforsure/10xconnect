"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_PROMPT =
  "Write a very short (4-8 word) observation about this lead, casual and friendly.";

/**
 * Inserts an AI-personalization chip. For E1 the user types a prompt inline; the
 * `onOpenPromptLibrary` hook is reserved for the E2 prompt library (when wired, a
 * "Browse library" entry appears). The generated text is produced per-lead at
 * preview/dispatch time (CLAUDE.md §7/§8).
 */
export function AiPromptButton({
  onInsert,
  onOpenPromptLibrary,
  disabled,
}: {
  onInsert: (prompt: string, promptId?: string) => void;
  onOpenPromptLibrary?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const insert = (): void => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    onInsert(trimmed);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className="size-4" />
        AI Prompt
      </Button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 space-y-2 rounded-xl border bg-popover p-2 text-popover-foreground shadow-soft-md">
          <p className="px-1 text-xs font-medium text-muted-foreground">
            AI personalization — generated per lead at send time.
          </p>
          <Textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-[80px]"
            placeholder="Describe what the AI should write…"
          />
          <div className="flex items-center justify-between">
            {onOpenPromptLibrary ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onOpenPromptLibrary();
                }}
              >
                Browse library
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" size="sm" onClick={insert}>
              Insert
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
