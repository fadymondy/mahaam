import type { TimeEntry } from "./types";

/** Seconds a running entry has run at `now` (or its stored duration once stopped). */
export function elapsedSeconds(e: Pick<TimeEntry, "started_at" | "ended_at" | "duration_s">, now = Date.now()): number {
  if (e.ended_at) return e.duration_s ?? Math.max(0, Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000));
  return Math.max(0, Math.floor((now - Date.parse(e.started_at)) / 1000));
}

/** 1:05:09 / 5:09 — the timer clock. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 1h 05m / 12m — durations in lists. */
export function duration(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** At most four characters for a toolbar badge: 7m, 59m, 1:05, 12h. */
export function badge(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 10) return `${h}:${String(m % 60).padStart(2, "0")}`;
  return `${Math.min(h, 999)}h`;
}

/**
 * When a running entry's next whole minute starts (epoch ms), which is when badge() next changes.
 * Counted from started_at, so a repaint scheduled for it lands on the minute the entry itself turns
 * over, not on some unrelated cadence.
 */
export function nextMinuteAt(e: Pick<TimeEntry, "started_at">, now = Date.now()): number {
  const start = Date.parse(e.started_at);
  const done = Math.max(0, Math.floor((now - start) / 60_000));
  return start + (done + 1) * 60_000;
}

/** What a running entry is about, for titles and tooltips. */
export function entryLabel(e: Pick<TimeEntry, "task_key" | "task_title" | "project_name" | "description">): string {
  if (e.task_key) return `${e.task_key} ${e.task_title ?? ""}`.trim();
  return e.description || e.project_name || "";
}
