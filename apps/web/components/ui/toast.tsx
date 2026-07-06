"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free toast system — transient, auto-dismissing pop-ups for
 * advisory notices that shouldn't eat permanent screen space (pacing hints,
 * "AI replies are off", etc.). Mount <ToastProvider> around a subtree and call
 * useToast().toast(...) from anywhere inside it. Kept in-house to match the
 * dark-token surfaces (bg-elevated + shadow-toast) rather than pull in a library.
 */

type ToastVariant = "default" | "warning" | "success" | "destructive";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /**
   * Stable id — re-firing the same id UPDATES the existing toast (content +
   * resets its auto-dismiss timer) instead of stacking a duplicate. This is what
   * lets an edit that changes an advisory refresh one toast instead of piling up.
   * Auto-generated when omitted.
   */
  id?: string;
  title?: string;
  description?: ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss after N ms. Default 10_000. Pass 0 to keep until dismissed. */
  duration?: number;
  action?: ToastAction;
}

interface ToastRecord {
  id: string;
  title?: string;
  description?: ReactNode;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
  /** Bumped every re-fire so the item's dismiss timer re-arms on update. */
  nonce: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Monotonic fallback id — avoids Date.now()/Math.random() (banned in some run
// contexts) and keeps ids stable/SSR-safe.
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions): string => {
    const id = opts.id ?? `toast-${(seq += 1)}`;
    setToasts((cur) => {
      const idx = cur.findIndex((t) => t.id === id);
      const base: ToastRecord = {
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant ?? "default",
        duration: opts.duration ?? 10_000,
        action: opts.action,
        nonce: idx >= 0 ? cur[idx].nonce + 1 : 0,
      };
      if (idx >= 0) {
        const copy = cur.slice();
        copy[idx] = base;
        return copy;
      }
      return [...cur, base];
    });
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}

// "Featured icon" look — a tinted rounded square holds the variant glyph on the
// left, matching the Untitled UI notification card. Tokens only, no new deps.
const VARIANT_STYLES: Record<ToastVariant, { tint: string; ring: string; icon: ReactNode }> = {
  default: {
    tint: "bg-white/[0.06] text-muted-foreground",
    ring: "ring-white/10",
    icon: <Info className="size-[18px]" />,
  },
  warning: {
    tint: "bg-warning/15 text-warning",
    ring: "ring-warning/30",
    icon: <AlertTriangle className="size-[18px]" />,
  },
  success: {
    tint: "bg-success/15 text-success",
    ring: "ring-success/30",
    icon: <CheckCircle2 className="size-[18px]" />,
  },
  destructive: {
    tint: "bg-destructive/15 text-destructive",
    ring: "ring-destructive/30",
    icon: <XCircle className="size-[18px]" />,
  },
};

function ToastViewport({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: string) => void }) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const { id, nonce, duration } = toast;
  // Auto-dismiss; re-arms whenever the toast is re-fired (nonce/duration change).
  useEffect(() => {
    if (duration <= 0) {
      return;
    }
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, nonce, duration, onDismiss]);

  const style = VARIANT_STYLES[toast.variant];
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex animate-slide-in-right items-start gap-3 rounded-xl border border-border bg-elevated p-3.5 text-sm text-foreground shadow-toast"
    >
      <span
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1",
          style.tint,
          style.ring,
        )}
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        {toast.title ? (
          <p className="text-[13.5px] font-semibold leading-snug">{toast.title}</p>
        ) : null}
        {toast.description ? (
          <div className={cn("text-[13px] leading-snug text-muted-foreground", toast.title && "mt-0.5")}>
            {toast.description}
          </div>
        ) : null}
        {toast.action ? (
          <div className="mt-2.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(id);
              }}
              className="text-[13px] font-semibold text-indigo-text transition-colors hover:text-foreground"
            >
              {toast.action.label}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(id)}
              className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 rounded-md p-1 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
