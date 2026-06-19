"use client";

import { Maximize2, Minus, Plus, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Stat, StatChip } from "./connectors";
import { useBuilder } from "./context";
import { Segment } from "./flow";

const DOTTED_BG: React.CSSProperties = {
  backgroundImage: "radial-gradient(hsl(255 30% 60% / 0.12) 1px, transparent 1px)",
  backgroundSize: "22px 22px",
  backgroundPosition: "11px 11px",
};

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1; // per button click
const ZOOM_WHEEL_STEP = 0.03; // per wheel tick — gentle so a trackpad gesture doesn't race
const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** The visual branching canvas: Campaign start → recursive forked sequence. */
export function SequenceCanvas() {
  const { stats } = useBuilder();
  const summary = stats?.summary;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  // Ctrl/⌘ + wheel zooms the canvas. Registered as a non-passive native listener
  // so preventDefault actually suppresses the browser's page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="h-[78vh] min-h-[32rem] overflow-auto rounded-2xl border bg-[hsl(250_30%_99%)]"
        style={DOTTED_BG}
      >
        {/* zoom scales the layout box (CSS `zoom`) so scrollbars track the real size */}
        <div className="flex min-w-max flex-col items-center px-8 py-8" style={{ zoom: String(zoom) }}>
          <div className="inline-flex items-center gap-2.5 rounded-full border bg-card px-4 py-2 font-display text-sm font-semibold shadow-soft">
            <span className="flex size-6 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="size-3.5" />
            </span>
            Campaign start
          </div>

          <StatChip>
            <Stat>{summary?.leads ?? 0}</Stat> leads · <Stat>{summary?.enrichedPct ?? 0}%</Stat> enriched
          </StatChip>

          <Segment edge={{ parentId: null, slot: "next" }} />
        </div>
      </div>

      {/* Zoom controls — pinned bottom-left of the canvas (outside the scroll area). */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-center gap-0.5 rounded-xl border bg-card/90 p-1 shadow-soft backdrop-blur">
        <ZoomButton label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))} disabled={zoom >= ZOOM_MAX}>
          <Plus className="size-4" />
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))} disabled={zoom <= ZOOM_MIN}>
          <Minus className="size-4" />
        </ZoomButton>
        <div className="my-0.5 h-px w-5 bg-border" />
        <ZoomButton label={`Reset zoom (currently ${Math.round(zoom * 100)}%)`} onClick={() => setZoom(1)}>
          <Maximize2 className="size-4" />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}
