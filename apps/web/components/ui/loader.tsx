import { cn } from "@/lib/utils";

/**
 * Animated "loading" loader — a sliding pill under a shifting "loading" label
 * (uiverse, alexruix). Markup mirrors the CSS in globals.css (.tenx-loader);
 * class names are namespaced to avoid colliding with generic .loader/.load.
 * Degrades to a static state under prefers-reduced-motion.
 */
export function Loader({ className }: { className?: string }) {
  return (
    <div className={cn("tenx-loader", className)} role="status" aria-label="Loading">
      <span className="tenx-loader-text">loading</span>
      <span className="tenx-load" />
    </div>
  );
}

/**
 * Centered full-panel loader that replaces the bespoke "Loading…" paragraphs.
 * Pass an optional label rendered beneath the animation.
 */
export function PageLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[40vh] w-full flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <Loader />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : null}
    </div>
  );
}
