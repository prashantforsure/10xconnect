"use client";

// PUBLIC white-label client report (agency parity). Outside the (app) route group,
// so it renders with NO app shell and NO auth — a clean, branded page an agency
// shares with its client. Fetches the aggregate-only public endpoint directly
// (no auth/workspace headers). Applies the workspace's branding (logo, name, color).

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const DEFAULT_ACCENT = "#4f46e5";
const HEX = /^#[0-9a-fA-F]{3,8}$/;

interface ClientReport {
  brand: { name: string | null; primaryColor: string | null; logoUrl: string | null };
  campaign: { name: string; status: string };
  metrics: {
    contacted: number;
    connectionRequests: number;
    accepted: number;
    acceptRate: number;
    messages: number;
    replies: number;
    replyRate: number;
  };
  funnel: Array<{ label: string; value: number; pct?: number }>;
}

export default function SharedCampaignReportPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [report, setReport] = useState<ClientReport | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ok">("loading");

  useEffect(() => {
    if (!token) {
      return;
    }
    let live = true;
    fetch(`${API_BASE}/public/campaigns/${token}/report`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ClientReport) => {
        if (live) {
          setReport(d);
          setState("ok");
        }
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [token]);

  const accent = useMemo(() => {
    const c = report?.brand.primaryColor;
    return c && HEX.test(c) ? c : DEFAULT_ACCENT;
  }, [report]);

  if (state === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center bg-neutral-50 text-neutral-400">
        <p className="text-sm">Loading report…</p>
      </main>
    );
  }
  if (state === "error" || !report) {
    return (
      <main className="grid min-h-dvh place-items-center bg-neutral-50 px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800">Report unavailable</h1>
          <p className="mt-1 text-sm text-neutral-500">
            This report link is invalid or has been turned off.
          </p>
        </div>
      </main>
    );
  }

  const { brand, campaign, metrics, funnel } = report;
  const brandName = brand.name || "Campaign report";
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.value));

  return (
    <main className="min-h-dvh bg-neutral-50 text-neutral-900">
      {/* Brand bar */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brandName} className="h-8 w-auto max-w-[180px] object-contain" />
          ) : (
            <span
              className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ background: accent }}
            >
              {brandName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-sm font-semibold tracking-tight">{brandName}</span>
          <span className="ml-auto text-xs uppercase tracking-wider text-neutral-400">
            Campaign report
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Title */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
            style={{ background: `${accent}1a`, color: accent }}
          >
            {campaign.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-500">Outreach performance summary.</p>

        {/* KPI cards */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Contacted" value={metrics.contacted} accent={accent} />
          <Kpi
            label="Accepted"
            value={metrics.accepted}
            sub={`${metrics.acceptRate}% of requests`}
            accent={accent}
          />
          <Kpi
            label="Replies"
            value={metrics.replies}
            sub={`${metrics.replyRate}% reply rate`}
            accent={accent}
          />
        </div>

        {/* Funnel */}
        <section className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-neutral-700">Sequence funnel</h2>
          <div className="mt-5 space-y-3.5">
            {funnel.map((f) => (
              <div key={f.label} className="flex items-center gap-4">
                <span className="w-28 shrink-0 text-sm text-neutral-600">{f.label}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-md bg-neutral-100">
                  <div
                    className="flex h-full items-center rounded-md px-2 text-xs font-semibold text-white transition-all"
                    style={{
                      width: `${Math.max(6, (f.value / maxFunnel) * 100)}%`,
                      background: accent,
                    }}
                  >
                    {f.value}
                  </div>
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-400">
                  {f.pct !== undefined ? `${f.pct}%` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-10 text-center text-xs text-neutral-400">
          Prepared by {brandName}
        </footer>
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color: accent }}>
        {value.toLocaleString()}
      </p>
      {sub ? <p className="mt-1 text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}
