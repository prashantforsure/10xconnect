"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Lightweight, dependency-free tooltip. Shows on hover/focus of the trigger.
 * Position defaults to top; pass `side` for others. Not a full popover — meant
 * for short hint labels.
 */
function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const pos = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
  }[side];

  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-white/10 bg-elevated px-2.5 py-1.5 text-[11.5px] font-medium text-popover-foreground opacity-0 shadow-raised transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          pos,
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}

export { Tooltip };
