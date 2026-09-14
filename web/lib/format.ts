// Locale-aware formatting for work data. Numbers, keys and dates are rendered inside <Ltr>.
import { intlTag, type Locale } from "@/lib/i18n-locale"

/** "3 min ago", "in 2 days" — Intl.RelativeTimeFormat in the UI locale. */
export function timeAgo(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—"
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return "—"
  const diff = (then - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: "auto" })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ]
  let v = diff
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit)
    v /= size
  }
  return rtf.format(Math.round(v), "year")
}

/** A calendar date (due dates, project dates) — no time, UTC so it never shifts a day. */
export function formatDay(value: string | null | undefined, locale: Locale, style: "short" | "medium" = "medium"): string {
  if (!value) return "—"
  const d = new Date(value.length === 10 ? value + "T00:00:00Z" : value)
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: "UTC",
    ...(style === "short" ? { day: "numeric", month: "short" } : { dateStyle: "medium" }),
  }).format(d)
}

/** YYYY-MM-DD of a stored date/time (UTC). */
export function dayKey(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

/** Overdue = the due day is before today (UTC) and the task is not done. */
export function isOverdue(due: string | null | undefined, completedAt: string | null | undefined): boolean {
  if (!due || completedAt) return false
  return due.slice(0, 10) < new Date().toISOString().slice(0, 10)
}

/** 150 -> "2h 30m" (Latin digits: durations stay LTR). */
export function minutes(n: number | null | undefined): string {
  if (!n) return "—"
  const h = Math.floor(n / 60)
  const m = n % 60
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ")
}

/** Minor units -> "1,250.00 USD". */
export function money(minor: number | null | undefined, currency: string | null | undefined, locale: Locale): string {
  if (minor == null) return "—"
  const cur = currency || "USD"
  try {
    return new Intl.NumberFormat(intlTag(locale), { style: "currency", currency: cur, numberingSystem: "latn" }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${cur}`
  }
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
