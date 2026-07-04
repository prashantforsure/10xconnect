"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Right-anchored slide-over panel for full-focus editing surfaces (composer,
 * lead detail, import, etc.). Dependency-light — mirrors modal.tsx: closes on
 * Escape + backdrop click, scroll-locks the body while open, and renders into a
 * portal so it floats above the app shell. Command Dark overlay surface:
 * bg-card panel with a left hairline + heavy overlay shadow over a dimmed
 * backdrop.
 */
export function SlideOver({
  open,
  onClose,
  title,
  widthClass = "w-[460px] max-w-[94vw]",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  widthClass?: string;
  children: ReactNode;
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
    // Scroll-lock the body while the panel is open; restore the prior value.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Panel"}
        className={cn(
          "flex h-full animate-slide-in-right flex-col border-l border-white/10 bg-inset text-card-foreground shadow-drawer",
          widthClass,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined ? (
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 text-[15px] font-semibold tracking-tight">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-md p-1 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 rounded-md p-1 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
