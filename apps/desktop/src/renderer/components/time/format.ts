// Time maths for the Time view. Every wall-clock value is in the WORKSPACE timezone (the server cuts
// days at its local midnight), never the machine's. Durations and clock times use Latin digits and
// are rendered inside <LtrText>.
import type { TimeEntry } from "../../../shared/types";
import { ApiError } from "@/lib/bridge";

/** 27000 → "7:30"; 0 → "" (or `empty`). Grid cells and totals. */
export function hm(sec: number, empty = ""): string {
  if (!sec || sec < 30) return empty;
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** HH:MM of an instant in `tz`, 24-hour, Latin digits. */
export function timeIn(iso: string | number | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** YYYY-MM-DD of an instant in `tz`. */
export function dayIn(iso: string | number | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A calendar day as a Date to format with `timeZone: "UTC"` (it is a date, not an instant). */
export const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

function tzOffset(ms: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(ms / 1000) * 1000;
}

/** The instant of a wall-clock time (YYYY-MM-DD + HH:MM) in `tz`, as RFC 3339 UTC. DST-safe. */
export function zonedToUtc(day: string, hhmm: string, tz: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let ms = wall - tzOffset(wall, tz);
  ms = wall - tzOffset(ms, tz);
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

/** "1:30", "1h30", "1h 30m", "90m", "90", "1.5", "1.5h" → minutes (0 when unreadable). */
export function parseDuration(v: string): number {
  const s = v.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)h(?:(\d{1,2})m?)?$/))) return Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0);
  if ((m = s.match(/^(\d+)m$/))) return Number(m[1]);
  if ((m = s.match(/^\d+\.\d+$/))) return Math.round(Number(s) * 60);
  if ((m = s.match(/^\d+$/))) return Number(s);
  return 0;
}

/** Seconds an entry covers (a running one up to now). */
export function entrySeconds(e: Pick<TimeEntry, "started_at" | "ended_at" | "duration_s">, now = Date.now()): number {
  if (e.ended_at) return e.duration_s ?? Math.max(0, Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000));
  return Math.max(0, Math.floor((now - Date.parse(e.started_at)) / 1000));
}

/** What an entry is about: its description, else its task, else its project. */
export function entryTitle(e: Pick<TimeEntry, "description" | "task_title" | "project_name">): string {
  return e.description || e.task_title || e.project_name || "";
}

/** The server's message for an API error (overlaps, locks, the future), else a fallback. */
export function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError || e instanceof Error) return e.message || fallback;
  return fallback;
}
