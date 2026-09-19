// Pure time helpers shared by the timer card, Today and the timesheet (unit-tested).
import type { TimeEntry } from "@/api/types";

/** Seconds an entry covers up to `now` (a running entry counts to now). */
export function entrySeconds(e: Pick<TimeEntry, "started_at" | "ended_at" | "duration_s">, now: number): number {
  if (e.ended_at && e.duration_s != null) return e.duration_s;
  const end = e.ended_at ? Date.parse(e.ended_at) : now;
  return Math.max(0, Math.floor((end - Date.parse(e.started_at)) / 1000));
}

/** "1:05:09" / "5:09"; always h:mm:ss when `long`. */
export function formatClock(total: number, long = true): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h || long ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "2h 05m" / "45m". */
export function formatDuration(total: number): string {
  const m = Math.round(Math.max(0, total) / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Calendar day "YYYY-MM-DD" of a date — in `timeZone` (the workspace's, which is how the API cuts days) or device-local. */
export function localDay(d: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    } catch {
      // unknown zone: fall through to device-local
    }
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Today's entries (started today, local time) with the running timer merged in once, newest first,
 * and their total up to now.
 */
export function todaySummary(entries: TimeEntry[], running: TimeEntry | null, now: number, timeZone?: string) {
  const today = localDay(new Date(now), timeZone);
  const byId = new Map<string, TimeEntry>();
  for (const e of entries) if (localDay(new Date(e.started_at), timeZone) === today) byId.set(e.id, e);
  if (running && localDay(new Date(running.started_at), timeZone) === today) byId.set(running.id, running);
  const list = [...byId.values()].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const total = list.reduce((s, e) => s + entrySeconds(e, now), 0);
  return { entries: list, total };
}

/** Parse "1h30", "1:30", "90", "1.5h", "45m" → minutes, or null. */
export function parseMinutes(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/))) return Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0);
  if ((m = s.match(/^(\d+)\s*m?$/))) return Number(m[1]);
  return null;
}

/** Monday-or-configured week start (ISO date) containing `d`; weekStart 0 = Sunday … 6. */
export function weekStartOf(d: Date, weekStart = 1): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - weekStart + 7) % 7;
  x.setDate(x.getDate() - diff);
  return localDay(x);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
}
