"use client";

import { VARIABLE_REGISTRY } from "@10xconnect/core";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Edit an AI-prompt chip's instruction in place. Opened by clicking an existing
 * AI chip in the body editor (the chip carries its current prompt). Contact
 * variables can be inserted as {{Label}} tokens, matching the AI prompt library.
 */
export function EditAiPromptModal({
  open,
  initialPrompt,
  onClose,
  onSave,
}: {
  open: boolean;
  initialPrompt: string;
  onClose: () => void;
  onSave: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Re-seed when a (different) chip is opened.
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
    }
  }, [open, initialPrompt]);

  const insertVar = (label: string): void => {
    const token = `{{${label}}}`;
    const ta = taRef.current;
    if (!ta) {
      setPrompt((p) => p + token);
      return;
    }
    const start = ta.selectionStart ?? prompt.length;
    const end = ta.selectionEnd ?? prompt.length;
    const next = prompt.slice(0, start) + token + prompt.slice(end);
    setPrompt(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit AI prompt"
      description="Adjust the instruction the AI follows for this part of the message. Reference contact details with {{Variable}}."
      className="max-w-lg"
    >
      <div className="space-y-3">
        <Textarea
          ref={taRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[170px]"
          placeholder="e.g. Write a short, friendly observation about their {{Headline}} — no more than 8 words, no punctuation."
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Insert variable:</span>
          <Select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                insertVar(e.target.value);
              }
              e.target.value = "";
            }}
            className="h-8 w-auto min-w-[11rem]"
          >
            <option value="">Choose…</option>
            {VARIABLE_REGISTRY.map((v) => (
              <option key={v.key} value={v.label}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(prompt.trim())} disabled={!prompt.trim()}>
            Save prompt
          </Button>
        </div>
      </div>
    </Modal>
  );
}
