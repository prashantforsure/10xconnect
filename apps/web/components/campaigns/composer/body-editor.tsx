"use client";

import { type MessageBody, type MessageSegment, variableLabel } from "@10xconnect/core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

/** Imperative handle the toolbar uses to insert chips/text at the caret. */
export interface BodyEditorHandle {
  insertVariable: (key: string, fallback?: string) => void;
  insertAi: (prompt?: string, promptId?: string) => void;
  insertText: (text: string) => void;
}

const VAR_CHIP_CLASS =
  "10xc-chip mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-tint-violet px-1.5 py-0.5 align-baseline text-xs font-medium text-[hsl(265_45%_45%)]";
const AI_CHIP_CLASS =
  "10xc-chip mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-baseline text-xs font-medium text-primary";

function chipRemoveButton(): HTMLButtonElement {
  const x = document.createElement("button");
  x.type = "button";
  x.dataset.chipRemove = "1";
  x.textContent = "×";
  x.setAttribute("contenteditable", "false");
  x.setAttribute("aria-label", "Remove");
  x.className = "ml-0.5 cursor-pointer rounded px-0.5 leading-none opacity-60 hover:opacity-100";
  return x;
}

function createSegmentNode(seg: MessageSegment): Node {
  if (seg.type === "text") {
    return document.createTextNode(seg.text);
  }
  const span = document.createElement("span");
  span.setAttribute("contenteditable", "false");
  const label = document.createElement("span");
  if (seg.type === "variable") {
    span.className = VAR_CHIP_CLASS;
    span.dataset.chip = "variable";
    span.dataset.key = seg.key;
    if (seg.fallback) {
      span.dataset.fallback = seg.fallback;
    }
    label.textContent = seg.fallback
      ? `${variableLabel(seg.key)} → ${seg.fallback}`
      : variableLabel(seg.key);
  } else {
    span.className = AI_CHIP_CLASS;
    span.dataset.chip = "ai";
    if (seg.prompt) {
      span.dataset.prompt = seg.prompt;
    }
    if (seg.promptId) {
      span.dataset.promptId = seg.promptId;
    }
    const preview = seg.prompt ? `: ${seg.prompt.slice(0, 24)}${seg.prompt.length > 24 ? "…" : ""}` : "";
    label.textContent = `✦ AI${preview}`;
  }
  span.appendChild(label);
  span.appendChild(chipRemoveButton());
  return span;
}

/** Merge consecutive text into one segment so the model stays canonical. */
function pushText(segs: MessageSegment[], text: string): void {
  if (!text) {
    return;
  }
  const last = segs[segs.length - 1];
  if (last && last.type === "text") {
    last.text += text;
  } else {
    segs.push({ type: "text", text });
  }
}

/** Serialize the editor DOM to segments (BR/block boundaries → newlines). */
function serialize(root: HTMLElement): MessageSegment[] {
  const segs: MessageSegment[] = [];
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        pushText(segs, child.textContent ?? "");
        return;
      }
      if (!(child instanceof HTMLElement)) {
        return;
      }
      if (child.dataset.chip === "variable") {
        segs.push({
          type: "variable",
          key: child.dataset.key ?? "",
          ...(child.dataset.fallback ? { fallback: child.dataset.fallback } : {}),
        });
        return;
      }
      if (child.dataset.chip === "ai") {
        segs.push({
          type: "ai",
          ...(child.dataset.prompt ? { prompt: child.dataset.prompt } : {}),
          ...(child.dataset.promptId ? { promptId: child.dataset.promptId } : {}),
        });
        return;
      }
      if (child.tagName === "BR") {
        pushText(segs, "\n");
        return;
      }
      // Block elements (browsers wrap new lines in <div>/<p>) → newline boundary.
      if (["DIV", "P"].includes(child.tagName) && segs.length > 0) {
        const last = segs[segs.length - 1];
        if (!(last.type === "text" && last.text.endsWith("\n"))) {
          pushText(segs, "\n");
        }
      }
      walk(child);
    });
  };
  walk(root);
  return segs;
}

export const BodyEditor = forwardRef<
  BodyEditorHandle,
  {
    value: MessageBody;
    onChange: (body: MessageBody) => void;
    disabled?: boolean;
    placeholder?: string;
  }
>(function BodyEditor({ value, onChange, disabled, placeholder }, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  // Tracks the last body we rendered/emitted so external updates re-render the DOM
  // but our own keystroke edits don't (which would reset the caret).
  const lastSerialized = useRef<string>("");

  useEffect(() => {
    const el = elRef.current;
    if (!el) {
      return;
    }
    const serialized = JSON.stringify(value);
    if (serialized === lastSerialized.current) {
      return;
    }
    lastSerialized.current = serialized;
    el.innerHTML = "";
    for (const seg of value.segments) {
      el.appendChild(createSegmentNode(seg));
    }
  }, [value]);

  const emit = (): void => {
    const el = elRef.current;
    if (!el) {
      return;
    }
    const body: MessageBody = { v: 1, segments: serialize(el) };
    lastSerialized.current = JSON.stringify(body);
    onChange(body);
  };

  const insertNode = (node: Node): void => {
    const el = elRef.current;
    if (!el || disabled) {
      return;
    }
    el.focus();
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    const space = document.createTextNode(" ");
    (node as ChildNode).after(space);
    range.setStartAfter(space);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    emit();
  };

  useImperativeHandle(ref, () => ({
    insertVariable: (key, fallback) => insertNode(createSegmentNode({ type: "variable", key, fallback })),
    insertAi: (prompt, promptId) => insertNode(createSegmentNode({ type: "ai", prompt, promptId })),
    insertText: (text) => insertNode(document.createTextNode(text)),
  }));

  const onClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    const remove = target.closest("[data-chip-remove]");
    if (remove) {
      e.preventDefault();
      remove.closest("[data-chip]")?.remove();
      emit();
    }
  };

  const onPaste = (e: React.ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    emit();
  };

  const showPlaceholder = value.segments.length === 0;

  return (
    <div className="relative">
      <div
        ref={elRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Message body"
        onInput={emit}
        onClick={onClick}
        onPaste={onPaste}
        className={cn(
          "min-h-[140px] w-full whitespace-pre-wrap rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed shadow-soft focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
      {showPlaceholder ? (
        <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
          {placeholder ?? "Write your message…"}
        </span>
      ) : null}
    </div>
  );
});
