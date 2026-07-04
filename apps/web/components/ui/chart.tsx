"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";

import { cn } from "@/lib/utils";

/** Coral-led series palette, wired to the --chart-* CSS variables. */
export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

export const AXIS_PROPS = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

export const GRID_STROKE = "hsl(var(--border))";

/** Responsive height wrapper so charts size consistently across the app. */
function ChartContainer({
  className,
  height = 260,
  children,
}: {
  className?: string;
  height?: number;
  children: React.ReactElement;
}) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/** Styled recharts tooltip content matching the warm theme. */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  return (
    <div className="rounded-lg border border-white/10 bg-elevated px-3 py-2 text-xs shadow-raised">
      {label !== undefined && (
        <div className="mb-1 font-medium text-foreground">{label}</div>
      )}
      <div className="space-y-1">
        {payload.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ background: item.color ?? CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="text-muted-foreground">{item.name ?? item.dataKey}</span>
            <span className="ml-auto font-semibold text-foreground">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip };
