"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Minimal accessible modal (overlay + centered card). Closes on Escape and
 * backdrop click. Kept dependency-free to avoid pulling in a dialog library for
 * the small surfaces (create workspace, delete confirm) used so far.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col animate-fade-in rounded-xl border border-white/10 bg-elevated p-5 text-popover-foreground shadow-modal",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-md p-1 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        {/* Title + description stay pinned; only the body scrolls when content is tall. */}
        <h2 className="shrink-0 pr-8 text-[15px] font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 shrink-0 text-[13px] text-muted-foreground">{description}</p>
        ) : null}
        <div className="-mr-2 mt-4 min-h-0 overflow-y-auto pr-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
