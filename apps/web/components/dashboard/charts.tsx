"use client";

import { Fragment } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartContainer,
  ChartTooltip,
  GRID_STROKE,
} from "@/components/ui/chart";

export interface FunnelDatum {
  name: string;
  value: number;
}

/**
 * Map a numeric series into SVG line + area paths (and the last point) within a
 * box. Pure geometry — shared by the hero area chart and the KPI sparklines so a
 * flat/empty series degrades to a centered baseline instead of breaking.
 */
function buildSpark(values: number[], width: number, height: number, padY = 4) {
  const n = values.length;
  if (n === 0) {
    return null;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const y = (v: number) => padY + (height - padY * 2) * (1 - (v - min) / span);
  const coords = values.map((v, i) => [n > 1 ? i * stepX : width / 2, y(v)] as const);
  const line = coords
    .map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`)
    .join(" ");
  return {
    line,
    area: `${line} L${width.toFixed(1)},${height} L0,${height} Z`,
    last: { x: coords[n - 1][0], y: coords[n - 1][1] },
  };
}

/** Tiny trend line for a KPI tile. */
export function Sparkline({
  values,
  color,
  width = 74,
  height = 26,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const spark = buildSpark(values, width, height, 3);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      {spark ? (
        <path
          d={spark.line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

/** Large filled area chart for the dashboard hero (renders on the dark card). */
export function HeroAreaChart({
  values,
  color = "#F2683C",
  height = 148,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const W = 440;
  const spark = buildSpark(values, W, height, 18);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.42" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {spark ? <path d={spark.area} fill="url(#heroFill)" /> : null}
      {spark ? (
        <path d={spark.line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {spark ? (
        <circle cx={spark.last.x} cy={spark.last.y} r={4} fill={color} stroke="hsl(var(--card))" strokeWidth={2.5} />
      ) : null}
    </svg>
  );
}

export interface FunnelStep {
  label: string;
  value: number;
  color: string;
  conversion?: string;
}

/** Horizontal conversion funnel: each bar's width is proportional to the top stage. */
export function HorizontalFunnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          <div className="flex items-center gap-3.5">
            <div className="w-24 shrink-0 text-[13px] font-semibold text-muted-foreground">{s.label}</div>
            <div
              className="flex h-[34px] items-center rounded-[9px] px-3 font-display text-sm font-bold text-white"
              style={{ width: `${Math.max((s.value / max) * 100, 12)}%`, minWidth: 64, background: s.color }}
            >
              {s.value.toLocaleString()}
            </div>
          </div>
          {i < steps.length - 1 ? (
            <div className="flex items-center gap-2 pl-[104px]">
              <span className="text-[11px] text-muted-foreground">{steps[i + 1].conversion ?? ""}</span>
              <div className="flex-1 border-t border-dashed border-border" />
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/** Outreach funnel as a vertical bar chart. All values are real totals. */
export function FunnelBarChart({ data }: { data: FunnelDatum[] }) {
  return (
    <ChartContainer height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis dataKey="name" {...AXIS_PROPS} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} />
        <Tooltip cursor={{ fill: "hsl(var(--accent))" }} content={<ChartTooltip />} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Circular health gauge (conic-gradient ring with the score in the center).
 * Color follows the four-state safety language: ≥80 healthy, ≥50 warming, else at-risk.
 */
export function HealthRing({ score, size = 84 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color =
    clamped >= 80 ? "hsl(var(--success))" : clamped >= 50 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  const inner = Math.round(size * 0.74);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} 0 ${clamped}%, hsl(var(--muted)) ${clamped}% 100%)`,
      }}
    >
      <div
        className="flex flex-col items-center justify-center rounded-full bg-card"
        style={{ width: inner, height: inner }}
      >
        <span className="font-display text-2xl font-bold leading-none">{clamped}</span>
        <span className="text-[9px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export interface MixDatum {
  name: string;
  value: number;
}

/** Channel / engagement mix as a donut. */
export function MixDonut({ data }: { data: MixDatum[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="relative">
      <ChartContainer height={220}>
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold">{total.toLocaleString()}</span>
        <span className="text-xs text-muted-foreground">total actions</span>
      </div>
    </div>
  );
}
