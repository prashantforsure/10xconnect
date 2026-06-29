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
  /** Replace the AI chip the user last clicked with an edited prompt (in place). */
  updateEditingAi: (prompt?: string, promptId?: string) => void;
}

const VAR_CHIP_CLASS =
  "10xc-chip mx-0.5 inline-flex select-none items-center gap-1 rounded-md border border-input bg-muted px-1.5 py-0.5 align-baseline font-mono text-xs font-medium text-muted-foreground";
const AI_CHIP_CLASS =
  "10xc-chip mx-0.5 inline-flex cursor-pointer select-none items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 align-baseline text-xs font-medium text-primary hover:bg-primary/25";

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

/** Caret position under a point — Chromium/WebKit vs Firefox (drag-to-reposition). */
function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === "function") {
    return doc.caretRangeFromPoint(x, y);
  }
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function createSegmentNode(seg: MessageSegment): Node {
  if (seg.type === "text") {
    return document.createTextNode(seg.text);
  }
  const span = document.createElement("span");
  span.setAttribute("contenteditable", "false");
  span.draggable = true;
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
    span.title = "Click to edit this AI prompt";
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
    /** Fired when the user clicks an existing AI chip (to reopen the prompt editor). */
    onEditAi?: (current: { prompt?: string; promptId?: string }) => void;
  }
>(function BodyEditor({ value, onChange, disabled, placeholder, onEditAi }, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  // The AI chip the user last clicked — the target of updateEditingAi().
  const editingChipRef = useRef<HTMLElement | null>(null);
  // Tracks the last body we rendered/emitted so external updates re-render the DOM
  // but our own keystroke edits don't (which would reset the caret).
  const lastSerialized = useRef<string>("");
  // Last caret position seen INSIDE the editor. Toolbar popovers (variable/AI
  // pickers) steal focus before insert runs, so we restore this saved range
  // instead of the live (lost) selection — chips land where the user was typing.
  const savedRangeRef = useRef<Range | null>(null);
  // The chip currently being dragged to a new position (drag-to-reposition).
  const draggedChipRef = useRef<HTMLElement | null>(null);
  // Floating insertion-point indicator shown while dragging a chip.
  const indicatorRef = useRef<HTMLSpanElement>(null);

  // Save the caret whenever the selection sits inside the editor — captures it
  // right up until focus moves to a toolbar popover (whose nodes are outside el).
  useEffect(() => {
    const onSelectionChange = (): void => {
      const el = elRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) {
        return;
      }
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

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
    // Read the saved caret BEFORE focusing — el.focus() can collapse the live
    // selection to the start, which is the original "inserts at the beginning" bug.
    const saved = savedRangeRef.current;
    el.focus();
    const sel = window.getSelection();
    if (!sel) {
      return;
    }
    let range: Range;
    if (saved && el.contains(saved.startContainer)) {
      range = saved.cloneRange();
    } else if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
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
    sel.removeAllRanges();
    sel.addRange(range);
    savedRangeRef.current = range.cloneRange();
    emit();
  };

  const hideIndicator = (): void => {
    if (indicatorRef.current) {
      indicatorRef.current.style.display = "none";
    }
  };

  const onDragStart = (e: React.DragEvent): void => {
    if (disabled) {
      return;
    }
    const target = e.target as HTMLElement;
    // Don't hijack the chip's remove "×" — it stays a click.
    if (target.closest("[data-chip-remove]")) {
      e.preventDefault();
      return;
    }
    const chip = target.closest("[data-chip]") as HTMLElement | null;
    if (!chip) {
      return;
    }
    draggedChipRef.current = chip;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ""); // Firefox won't start a drag without data.
  };

  const onDragOver = (e: React.DragEvent): void => {
    const el = elRef.current;
    if (disabled || !draggedChipRef.current || !el) {
      return;
    }
    e.preventDefault(); // Required so a drop can fire.
    e.dataTransfer.dropEffect = "move";
    const range = caretRangeFromPoint(e.clientX, e.clientY);
    const indicator = indicatorRef.current;
    const host = el.parentElement;
    if (!range || !indicator || !host || !el.contains(range.startContainer)) {
      hideIndicator();
      return;
    }
    const rect = range.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    indicator.style.display = "block";
    indicator.style.left = `${rect.left - hostRect.left}px`;
    indicator.style.top = `${rect.top - hostRect.top}px`;
    indicator.style.height = `${rect.height || 18}px`;
  };

  const onDrop = (e: React.DragEvent): void => {
    const chip = draggedChipRef.current;
    draggedChipRef.current = null;
    hideIndicator();
    const el = elRef.current;
    if (disabled || !chip || !el) {
      return;
    }
    e.preventDefault(); // Prevent contentEditable's own drop (would duplicate content).
    const range = caretRangeFromPoint(e.clientX, e.clientY);
    // Ignore drops outside the editor or back inside the chip being moved.
    if (!range || !el.contains(range.startContainer) || chip.contains(range.startContainer)) {
      return;
    }
    range.insertNode(chip); // Existing node → moved, not copied.
    const space = document.createTextNode(" ");
    chip.after(space);
    range.setStartAfter(space);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRangeRef.current = range.cloneRange();
    emit();
  };

  const onDragEnd = (): void => {
    draggedChipRef.current = null;
    hideIndicator();
  };

  useImperativeHandle(ref, () => ({
    insertVariable: (key, fallback) => insertNode(createSegmentNode({ type: "variable", key, fallback })),
    insertAi: (prompt, promptId) => insertNode(createSegmentNode({ type: "ai", prompt, promptId })),
    insertText: (text) => insertNode(document.createTextNode(text)),
    updateEditingAi: (prompt, promptId) => {
      const chip = editingChipRef.current;
      if (!chip) {
        return;
      }
      const fresh = createSegmentNode({
        type: "ai",
        ...(prompt ? { prompt } : {}),
        ...(promptId ? { promptId } : {}),
      });
      chip.replaceWith(fresh);
      editingChipRef.current = fresh as HTMLElement;
      emit();
    },
  }));

  const onClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    const remove = target.closest("[data-chip-remove]");
    if (remove) {
      e.preventDefault();
      remove.closest("[data-chip]")?.remove();
      emit();
      return;
    }
    // Click an AI chip → reopen the prompt editor pre-filled (edit in place).
    const aiChip = target.closest('[data-chip="ai"]') as HTMLElement | null;
    if (aiChip && onEditAi) {
      e.preventDefault();
      editingChipRef.current = aiChip;
      onEditAi({ prompt: aiChip.dataset.prompt, promptId: aiChip.dataset.promptId });
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
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={cn(
          "min-h-[140px] w-full whitespace-pre-wrap rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
      {/* Insertion-point indicator shown while dragging a chip. */}
      <span
        ref={indicatorRef}
        aria-hidden
        className="pointer-events-none absolute hidden w-0.5 rounded bg-primary"
        style={{ display: "none" }}
      />
      {showPlaceholder ? (
        <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
          {placeholder ?? "Write your message…"}
        </span>
      ) : null}
    </div>
  );
});
