// Per-weekday working-hours windows in UTC (CLAUDE.md §6). The scheduler only
// dispatches inside the window; outside it, work is pushed to the next opening.
// Pure helpers shared by the campaign Schedule settings and the scheduler.

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface DaySchedule {
  enabled: boolean;
  /** "HH:MM" 24h, UTC. */
  start: string;
  /** "HH:MM" 24h, UTC. Must be after start. */
  end: string;
}

export type WeekSchedule = Record<Weekday, DaySchedule>;

const WEEKDAY_ORDER: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Default: weekdays 09:00–18:00 UTC (9h), weekends off. Recommend ≥7h/day. */
export function defaultWeekSchedule(): WeekSchedule {
  const weekday: DaySchedule = { enabled: true, start: "09:00", end: "18:00" };
  const off: DaySchedule = { enabled: false, start: "09:00", end: "18:00" };
  return {
    sun: { ...off },
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...off },
  };
}

function parseHhMm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

function dayKeyForDate(date: Date): Weekday {
  return WEEKDAY_ORDER[date.getUTCDay()];
}

/** Minutes since UTC midnight for a date. */
function minutesOfDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/** True if `date` (default now) falls inside the schedule's working window. */
export function isWithinWorkingHours(schedule: WeekSchedule, date: Date = new Date()): boolean {
  const day = schedule[dayKeyForDate(date)];
  if (!day || !day.enabled) {
    return false;
  }
  const start = parseHhMm(day.start);
  const end = parseHhMm(day.end);
  if (start === null || end === null || end <= start) {
    return false;
  }
  const now = minutesOfDay(date);
  return now >= start && now < end;
}

/**
 * The earliest instant at/after `from` that is inside the working window. If
 * `from` is already inside, returns `from`. Scans up to 14 days ahead; returns
 * `from` as a fallback if the schedule has no enabled days (caller may still
 * choose to hold). Used by the scheduler to push dispatch into the next opening.
 */
export function nextWorkingTime(schedule: WeekSchedule, from: Date = new Date()): Date {
  if (isWithinWorkingHours(schedule, from)) {
    return from;
  }
  const cursor = new Date(from.getTime());
  for (let i = 0; i < 14 * 24 * 60; i += 1) {
    // Step minute-by-minute is wasteful; jump to each day's start instead.
    const day = schedule[dayKeyForDate(cursor)];
    const start = day?.enabled ? parseHhMm(day.start) : null;
    if (start !== null) {
      const candidate = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
          Math.floor(start / 60),
          start % 60,
          0,
          0,
        ),
      );
      if (candidate.getTime() >= from.getTime() && isWithinWorkingHours(schedule, candidate)) {
        return candidate;
      }
    }
    // Advance to next day's 00:00 UTC.
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return from;
}

export interface ScheduleValidation {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/** Validate a schedule and warn on very short windows (<7h recommended). */
export function validateSchedule(schedule: WeekSchedule): ScheduleValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  let enabledDays = 0;
  for (const day of WEEKDAY_ORDER) {
    const d = schedule[day];
    if (!d || !d.enabled) {
      continue;
    }
    enabledDays += 1;
    const start = parseHhMm(d.start);
    const end = parseHhMm(d.end);
    if (start === null || end === null) {
      errors.push(`${day}: invalid time (use HH:MM 24h UTC).`);
      continue;
    }
    if (end <= start) {
      errors.push(`${day}: end time must be after start time.`);
      continue;
    }
    if (end - start < 7 * 60) {
      warnings.push(`${day}: window is under 7 hours — a longer window looks more natural.`);
    }
  }
  if (enabledDays === 0) {
    warnings.push("No working days enabled — campaigns will not dispatch.");
  }
  return { valid: errors.length === 0, warnings, errors };
}
