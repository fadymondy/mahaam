// Report helpers: role gates (internal/authz/can.go), date presets in the workspace timezone, and
// cell formatting identical to the export (internal/work/export.go: HM, Hours, Money) so the screen
// and the downloaded file agree cell for cell.
import { useQuery } from "@tanstack/react-query";

import type { ExportFile } from "../../../main/api-reports";
import { addDays, dayIn } from "@/components/time/format";
import { useApp } from "@/lib/app";
import { api, ApiError } from "@/lib/bridge";
import { qk } from "@/lib/query";

const RANK: Record<string, number> = { client: 0, member: 1, manager: 2, admin: 3, owner: 4 };

/** What the signed-in role may do with reports. */
export function useReportRole() {
  const role = useApp().workspace?.role ?? "member";
  const r = RANK[role] ?? 0;
  return { read: r >= 1, all: r >= 2, finance: r >= 2, share: r >= 2, clients: r >= 2 };
}

/** The workspace's timezone, week start and rounding (GET /api/w/time/settings). */
export function useWorkspaceTime() {
  const { ws } = useApp();
  const q = useQuery({ queryKey: qk.timeSettings(ws), queryFn: () => api.timeSettings(), enabled: !!ws, staleTime: 5 * 60_000 });
  const tz = q.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { ready: !!q.data || !!q.error, tz, weekStart: q.data?.week_start ?? 1, rounding: q.data?.rounding_minutes ?? 0, today: dayIn(Date.now(), tz) };
}

// ── presets ──

export type Preset = "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "custom";
export const PRESETS: Exclude<Preset, "custom">[] = ["this_week", "last_week", "this_month", "last_month", "this_year"];

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

function lastOfMonth(first: string) {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export function presetRange(p: Exclude<Preset, "custom">, today: string, weekStart: number): { from: string; to: string } {
  const back = (weekday(today) - weekStart + 7) % 7;
  const start = addDays(today, -back);
  switch (p) {
    case "this_week":
      return { from: start, to: addDays(start, 6) };
    case "last_week":
      return { from: addDays(start, -7), to: addDays(start, -1) };
    case "this_month": {
      const first = today.slice(0, 8) + "01";
      return { from: first, to: lastOfMonth(first) };
    }
    case "last_month": {
      const prev = addDays(today.slice(0, 8) + "01", -1);
      return { from: prev.slice(0, 8) + "01", to: prev };
    }
    case "this_year":
      return { from: today.slice(0, 4) + "-01-01", to: today.slice(0, 4) + "-12-31" };
  }
}

export function presetOf(from: string | undefined, to: string | undefined, today: string, weekStart: number): Preset {
  if (!from || !to) return "this_month";
  for (const p of PRESETS) {
    const r = presetRange(p, today, weekStart);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

// ── cells (Go: HM, Hours, Money) ──

export function hmCell(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

export const hoursCell = (sec: number) => (sec / 3600).toFixed(2);

export function moneyCell(minor: number | null | undefined) {
  if (minor == null) return "";
  const sign = minor < 0 ? "-" : "";
  const m = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(m / 100)}.${String(m % 100).padStart(2, "0")}`;
}

export const percentCell = (p: number | null | undefined) => (p == null ? "" : p.toFixed(1));

// ── errors & files ──

/** An API error in words, with the plan (402) and permission (403) cases made clear. */
export function reportError(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return `${t("reports.planFeature")} ${err.message ? `(${err.message})` : ""}`.trim();
    if (err.status === 403) return t("reports.forbidden");
    return err.message || t("common.error");
  }
  return err instanceof Error && err.message ? err.message : t("common.error");
}

/** Save a file the API returned, as the browser would (a Blob and an <a download>). */
export function saveFile(f: ExportFile) {
  const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
