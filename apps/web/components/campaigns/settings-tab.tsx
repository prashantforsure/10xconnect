"use client";

import { Info } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";

const CAP_LABELS: Record<string, string> = {
  connection_request: "Connection requests",
  message: "Messages",
  voice_note: "Voice notes",
  inmail: "InMails",
  open_profile_message: "Open-profile messages",
  comment_post: "Comments",
  reply_comment: "Comment replies",
  like_post: "Likes",
  visit_profile: "Profile visits",
  follow_lead: "Follows",
};

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
}
type WeekSchedule = Record<string, DaySchedule>;

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function SettingsTab({ campaignId, onChanged }: { campaignId: string; onChanged: () => void }) {
  return (
    <div className="max-w-3xl space-y-6">
      <GeneralCard campaignId={campaignId} onChanged={onChanged} />
      <FrequencyCard campaignId={campaignId} />
      <ScheduleCard campaignId={campaignId} />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border bg-secondary/40 px-4 py-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
      {items.map((w) => (
        <li key={w} className="flex gap-2">
          <span className="text-warning-foreground">•</span>
          {w}
        </li>
      ))}
    </ul>
  );
}

function GeneralCard({ campaignId, onChanged }: { campaignId: string; onChanged: () => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [skip, setSkip] = useState(true);
  const [excludeConn, setExcludeConn] = useState(true);
  const [followUpCap, setFollowUpCap] = useState(3);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await api.request<{
      name: string;
      settings: {
        skip_already_contacted: boolean;
        exclude_conn_req_from_reply_rate: boolean;
        follow_up_cap: number;
      };
    }>(`/campaigns/${campaignId}`);
    setName(c.name);
    setSkip(c.settings.skip_already_contacted);
    setExcludeConn(c.settings.exclude_conn_req_from_reply_rate);
    setFollowUpCap(c.settings.follow_up_cap ?? 3);
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      await api.request(`/campaigns/${campaignId}`, {
        method: "PATCH",
        body: {
          name,
          settings: {
            skip_already_contacted: skip,
            exclude_conn_req_from_reply_rate: excludeConn,
            follow_up_cap: followUpCap,
          },
        },
      });
      setMsg("Saved");
      onChanged();
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="General" description="Name and contact rules.">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ToggleRow
          label="Skip leads already contacted by another campaign"
          checked={skip}
          onChange={setSkip}
        />
        <ToggleRow
          label="Exclude connection-request messages from reply-rate"
          checked={excludeConn}
          onChange={setExcludeConn}
        />
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-secondary/40 px-4 py-3 text-sm">
          <div>
            <div>Follow-up cap</div>
            <p className="text-xs text-muted-foreground">
              Max follow-ups per lead before stopping (follow-up discipline).
            </p>
          </div>
          <Input
            type="number"
            min={0}
            max={20}
            value={followUpCap}
            onChange={(e) => setFollowUpCap(Number(e.target.value))}
            className="h-8 w-20"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
        </div>
      </div>
    </Section>
  );
}

function FrequencyCard({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [caps, setCaps] = useState<Record<string, number>>({});
  const [ceilings, setCeilings] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.request<{ caps: Record<string, number>; ceilings: Record<string, number> }>(
      `/campaigns/${campaignId}/settings/frequency`,
    );
    setCaps(res.caps);
    setCeilings(res.ceilings);
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.request<{ caps: Record<string, number>; warnings: string[] }>(
        `/campaigns/${campaignId}/settings/frequency`,
        { method: "PUT", body: { caps } },
      );
      setCaps(res.caps);
      setWarnings(res.warnings);
      setMsg("Saved");
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Frequency (daily caps)"
      description="Per-account daily limits, aggregated across campaigns. Values above the safe maximum are clamped automatically."
    >
      <div className="mb-4 flex gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-3 text-xs">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="text-muted-foreground">
          <strong className="text-foreground">Note:</strong> these numbers may vary with your
          account&apos;s health and activity on other campaigns. We adjust them automatically to keep
          your accounts safe.
        </span>
      </div>
      <div className="space-y-5">
        {Object.keys(CAP_LABELS).map((type) => {
          const max = ceilings[type] ?? 50;
          const value = caps[type] ?? 0;
          return (
            <div key={type} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`cap-${type}`} className="text-sm font-medium">
                  Max {CAP_LABELS[type]}/day
                </Label>
                <span className="text-[11px] text-muted-foreground">safe max {max}</span>
              </div>
              <div className="flex items-center gap-4">
                <Slider
                  id={`cap-${type}`}
                  value={Math.min(value, max)}
                  onValueChange={(v) => setCaps({ ...caps, [type]: v })}
                  min={0}
                  max={max}
                  aria-label={CAP_LABELS[type]}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  max={max}
                  value={value}
                  onChange={(e) => setCaps({ ...caps, [type]: Number(e.target.value) })}
                  className="h-10 w-16 shrink-0 text-center text-sm font-semibold tabular-nums"
                  aria-label={`${CAP_LABELS[type]} per day`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <Warnings items={warnings} />
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save caps"}
        </Button>
        {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
      </div>
    </Section>
  );
}

function ScheduleCard({ campaignId }: { campaignId: string }) {
  const api = useApi();
  const [schedule, setSchedule] = useState<WeekSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.request<{ schedule: WeekSchedule }>(`/campaigns/${campaignId}/settings/schedule`);
    setSchedule(res.schedule);
  }, [api, campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  const update = (day: string, patch: Partial<DaySchedule>): void => {
    if (!schedule) {
      return;
    }
    setSchedule({ ...schedule, [day]: { ...schedule[day], ...patch } });
  };

  // Enabled days must have start < end — an inverted window makes the dispatch
  // scheduler's working-hours math undefined (mirrors the server-side check).
  const invalidDays = schedule
    ? DAYS.filter((d) => {
        const day = schedule[d.key];
        return day?.enabled && day.start >= day.end;
      }).map((d) => d.label)
    : [];

  const save = async (): Promise<void> => {
    if (!schedule || invalidDays.length > 0) {
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.request<{ warnings: string[] }>(`/campaigns/${campaignId}/settings/schedule`, {
        method: "PUT",
        body: { schedule },
      });
      setWarnings(res.warnings);
      setMsg("Saved");
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  if (!schedule) {
    return null;
  }

  return (
    <Section
      title="Schedule (UTC)"
      description="Working hours per weekday (UTC). Actions only dispatch inside these windows. ≥7 hours/day is recommended."
    >
      <div className="space-y-2">
        {DAYS.map((d) => {
          const day = schedule[d.key]!;
          return (
            <div
              key={d.key}
              className="flex items-center gap-3 rounded-xl border bg-secondary/40 px-3 py-2"
            >
              <div className="flex w-36 items-center gap-2.5">
                <Switch
                  checked={day.enabled}
                  onCheckedChange={(v) => update(d.key, { enabled: v })}
                  aria-label={d.label}
                />
                <span className="text-sm">{d.label}</span>
              </div>
              <Input
                type="time"
                value={day.start}
                onChange={(e) => update(d.key, { start: e.target.value })}
                disabled={!day.enabled}
                className="h-8 w-28"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="time"
                value={day.end}
                onChange={(e) => update(d.key, { end: e.target.value })}
                disabled={!day.enabled}
                className="h-8 w-28"
              />
            </div>
          );
        })}
      </div>
      {invalidDays.length > 0 ? (
        <p className="mt-3 text-sm text-destructive">
          Start must be before end on: {invalidDays.join(", ")}.
        </p>
      ) : null}
      <Warnings items={warnings} />
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || invalidDays.length > 0}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
        {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
      </div>
    </Section>
  );
}
