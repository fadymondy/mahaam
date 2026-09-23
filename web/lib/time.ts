"use client"

// P2 time tracking: contract types (mirror internal/work JSON), SWR hooks for /api/w/time/*, the
// inbox, time formatting in the WORKSPACE timezone, and the per-user live stream that keeps every
// tab and device on the same timer.
import { useEffect, useState } from "react"
import useSWR, { useSWRConfig } from "swr"

import { api, ApiError } from "@/lib/api"
import { intlTag, type Locale } from "@/lib/i18n-locale"

// ── contract ─────────────────────────────────────────────────────────────────

export type TimeSource = "timer" | "manual" | "mcp" | "import"

export type TimeEntry = {
  id: string
  user_id: string
  project_id: string | null
  project_name: string | null
  project_color: string | null
  task_id: string | null
  task_key: string | null
  task_title: string | null
  client_id: string | null
  client_name: string | null
  description: string
  started_at: string
  ended_at: string | null
  duration_s: number | null
  billable: boolean
  bill_rate_minor?: number | null
  cost_rate_minor?: number | null
  currency: string
  source: TimeSource
  locked: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export type TimerChange = { started: TimeEntry; stopped: TimeEntry | null }

export type TimesheetRow = {
  project_id: string | null
  project_name: string | null
  project_color: string | null
  task_id: string | null
  task_key: string | null
  task_title: string | null
  seconds: number[]
  total_s: number
}

export type EntrySlice = { entry_id: string; day: string; start: string; end: string; seconds: number }

export type Timesheet = {
  user_id: string
  timezone: string
  week_start: number
  rounding_minutes: number
  days: string[]
  rows: TimesheetRow[]
  day_totals: number[]
  total_s: number
  rounded_total_s: number
  billable_s: number
  entries: TimeEntry[]
  slices: EntrySlice[]
  running: TimeEntry | null
  now: string
}

export type TeamRow = { user_id: string; role: string; seconds: number[]; total_s: number; billable_s: number; running: boolean }

export type TeamTimesheet = {
  timezone: string
  week_start: number
  rounding_minutes: number
  days: string[]
  members: TeamRow[]
  day_totals: number[]
  total_s: number
  rounded_total_s: number
  billable_s: number
}

export type TimeSettings = {
  timezone: string
  week_start: number
  rounding_minutes: number
  currency: string
  locale: string
  default_bill_rate_minor?: number | null
  default_cost_rate_minor?: number | null
  reminder_running_hours: number
  reminder_daily: boolean
  can_manage: boolean
}

export type MemberRate = {
  id: string
  user_id: string
  effective_from: string
  bill_rate_minor: number | null
  cost_rate_minor: number | null
  currency: string
  created_by: string
  created_at: string
}

export type MemberRates = { user_id: string; role: string; current: MemberRate | null; history: MemberRate[] }

export type RateSheet = {
  currency: string
  timezone: string
  today: string
  default_bill_rate_minor: number | null
  default_cost_rate_minor: number | null
  members: MemberRates[]
  can_manage: boolean
}

export type AppNotification = {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export type Inbox = { notifications: AppNotification[]; unread: number }

// ── hooks ────────────────────────────────────────────────────────────────────

const opts = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
}

function useW<T>(path: string | null, ws: string | null | undefined) {
  return useSWR<T>(path && ws ? [path, ws] : null, ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }), opts)
}

function qs(params: Record<string, string | null | undefined>) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v)
  const str = s.toString()
  return str ? `?${str}` : ""
}

export const RUNNING = "/api/w/time/running"

export const useRunning = (ws: string | null | undefined, enabled = true) => useW<{ timer: TimeEntry | null }>(enabled ? RUNNING : null, ws)
export const useTimesheet = (ws: string, week?: string | null, user?: string | null) =>
  useW<Timesheet>(`/api/w/time/timesheet${qs({ week, user })}`, ws)
export const useTeamTimesheet = (ws: string, week: string | null, enabled: boolean) =>
  useW<TeamTimesheet>(enabled ? `/api/w/time/team${qs({ week })}` : null, ws)
export const useTimeSettings = (ws: string | null | undefined) => useW<TimeSettings>("/api/w/time/settings", ws)
export const useRates = (ws: string, enabled: boolean) => useW<RateSheet>(enabled ? "/api/w/rates" : null, ws)
export const useInbox = (ws: string | null | undefined) => useW<Inbox>("/api/w/notifications?limit=30", ws)

export type StartBody = { project?: string; task?: string; description?: string; billable?: boolean }
export type LogBody = StartBody & { user?: string; date?: string; started_at?: string; ended_at?: string; minutes?: number }
export type EntryPatch = { project?: string; task?: string; description?: string; billable?: boolean; started_at?: string; ended_at?: string }

/** Mutations, always scoped to the workspace. */
export const timeApi = {
  start: (ws: string, body: StartBody) => api<TimerChange>("/api/w/time/start", { method: "POST", json: body, workspaceId: ws }),
  stop: (ws: string, user?: string) => api<TimeEntry>("/api/w/time/stop", { method: "POST", json: user ? { user } : {}, workspaceId: ws }),
  log: (ws: string, body: LogBody) => api<TimeEntry>("/api/w/time/entries", { method: "POST", json: body, workspaceId: ws }),
  update: (ws: string, id: string, body: EntryPatch) =>
    api<TimeEntry>(`/api/w/time/entries/${encodeURIComponent(id)}`, { method: "PATCH", json: body, workspaceId: ws }),
  remove: (ws: string, id: string) => api<void>(`/api/w/time/entries/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws }),
  settings: (ws: string, body: Record<string, unknown>) => api<TimeSettings>("/api/w/time/settings", { method: "PATCH", json: body, workspaceId: ws }),
  setRate: (ws: string, user: string, body: { effective_from?: string; bill_rate_minor?: number; cost_rate_minor?: number }) =>
    api<MemberRate>(`/api/w/rates/${encodeURIComponent(user)}`, { method: "PUT", json: body, workspaceId: ws }),
  deleteRate: (ws: string, id: string) => api<void>(`/api/w/member-rates/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws }),
  read: (ws: string, id: string) => api<void>(`/api/w/notifications/${encodeURIComponent(id)}/read`, { method: "POST", json: {}, workspaceId: ws }),
  readAll: (ws: string) => api<{ read: number }>("/api/w/notifications/read-all", { method: "POST", json: {}, workspaceId: ws }),
}

const isKey = (key: unknown, ws: string, prefix: string) =>
  Array.isArray(key) && key[1] === ws && typeof key[0] === "string" && (key[0] as string).startsWith(prefix)

/** Revalidate every time view of a workspace (the timer bar, timesheets, lists). */
export function useRefreshTime() {
  const { mutate } = useSWRConfig()
  return (ws: string) => mutate((key) => isKey(key, ws, "/api/w/time/"))
}

// ── the live stream ──────────────────────────────────────────────────────────

export type LiveState = "connecting" | "open" | "closed"

/*
  GET /api/w/events: the caller's own events in this workspace (internal/live). Mounted once, in
  the workspace shell. fetch rather than EventSource, because the stream needs X-Workspace-ID and
  EventSource cannot send headers. The first event is timer.state (the truth), so a reconnect after
  missed events is correct immediately; after that timer.started / timer.stopped / entry.changed /
  notification.* update the cache of this tab, and task.* / issue.* / project.updated refetch the
  boards and lists they touch.
*/
export function useLiveStream(ws: string | null | undefined): LiveState {
  const { mutate } = useSWRConfig()
  const [state, setState] = useState<LiveState>("connecting")

  useEffect(() => {
    if (!ws) return
    let stopped = false
    let ctrl: AbortController | null = null
    let delay = 1000
    const refresh = (prefix: string) => mutate((key) => isKey(key, ws, prefix))

    const onEvent = (name: string, data: string) => {
      let payload: unknown = null
      try {
        payload = JSON.parse(data)
      } catch {
        return
      }
      const running = [RUNNING, ws]
      if (name === "timer.state") {
        void mutate(running, { timer: (payload as { running?: TimeEntry | null })?.running ?? null }, { revalidate: false })
        return
      }
      if (name === "timer.started") {
        void mutate(running, { timer: payload as TimeEntry }, { revalidate: false })
      } else if (name === "timer.stopped") {
        const id = (payload as { id?: string })?.id
        void mutate(running, (cur?: { timer: TimeEntry | null }) => (cur?.timer && cur.timer.id === id ? { timer: null } : cur), { revalidate: false })
      }
      if (name.startsWith("timer.") || name === "entry.changed") {
        void mutate((key) => isKey(key, ws, "/api/w/time/") && !(Array.isArray(key) && key[0] === RUNNING))
        void mutate((key) => isKey(key, ws, "/api/w/tasks/") && Array.isArray(key) && String(key[0]).endsWith("/activity"))
      }
      if (name.startsWith("notification.")) void refresh("/api/w/notifications")
      // Boards (MH-351): the events carry ids only, so each one is a cue to refetch what's on
      // screen; the reads apply the access rules. SWR folds a burst into one request per key.
      if (name.startsWith("task.")) {
        void refresh("/api/w/tasks")
        void refresh("/api/w/projects")
      }
      if (name.startsWith("issue.")) void refresh("/api/w/issues")
      if (name === "project.updated") void refresh("/api/w/projects")
    }

    const run = async () => {
      while (!stopped) {
        ctrl = new AbortController()
        setState("connecting")
        try {
          const res = await fetch("/api/w/events", {
            headers: { "X-Workspace-ID": ws, Accept: "text/event-stream" },
            credentials: "same-origin",
            cache: "no-store",
            signal: ctrl.signal,
          })
          if (res.status === 401 || res.status === 404) {
            setState("closed")
            return
          }
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`)
          setState("open")
          delay = 1000
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          let buf = ""
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += value.replace(/\r\n/g, "\n")
            let cut: number
            while ((cut = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, cut)
              buf = buf.slice(cut + 2)
              let name = "message"
              let data = ""
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) name = line.slice(7)
                else if (line.startsWith("data: ")) data += line.slice(6)
              }
              if (data) onEvent(name, data)
            }
          }
        } catch {
          if (stopped) return
        }
        if (stopped) return
        setState("connecting")
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 15000)
        void refresh("/api/w/time/")
        void refresh("/api/w/notifications")
        // No replay: whatever changed while the stream was down is only seen by refetching.
        void refresh("/api/w/tasks")
        void refresh("/api/w/issues")
        void refresh("/api/w/projects")
      }
    }
    void run()
    return () => {
      stopped = true
      ctrl?.abort()
    }
  }, [ws, mutate])

  return state
}

// ── time and formatting ──────────────────────────────────────────────────────

/** Date.now(), re-rendering every `ms` while enabled (the running timer's clock). */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms, enabled])
  return now
}

/** Seconds an entry covers (a running one up to now). */
export function entrySeconds(e: Pick<TimeEntry, "started_at" | "ended_at" | "duration_s">, nowMs = Date.now()) {
  if (e.duration_s != null) return e.duration_s
  return Math.max(0, Math.floor((nowMs - new Date(e.started_at).getTime()) / 1000))
}

/** 3725 -> "1:02:05" — the running clock. Latin digits; render inside <Ltr>. */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
}

/** 27000 -> "7:30", 0 -> "" — grid cells. */
export function hm(sec: number, empty = "") {
  if (!sec) return empty
  const m = Math.round(sec / 60)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
}

/** HH:MM of an instant in a timezone, 24-hour, Latin digits. */
export function timeIn(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
}

/** YYYY-MM-DD of an instant in a timezone. */
export function dayIn(iso: string | number | Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

/** "Mon 14 Sep" for a YYYY-MM-DD, in the UI language (the date is a calendar day: formatted in UTC). */
export function dayLabel(day: string, locale: Locale, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: "UTC",
    numberingSystem: "latn",
    ...(style === "short" ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  }).format(new Date(day + "T00:00:00Z"))
}

export function weekdayShort(day: string, locale: Locale) {
  return new Intl.DateTimeFormat(intlTag(locale), { timeZone: "UTC", weekday: "short" }).format(new Date(day + "T00:00:00Z"))
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no timezone). */
export function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Offset (ms) of `tz` from UTC at instant `ms`. */
function tzOffset(ms: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(ms / 1000) * 1000
}

/** The instant of a wall-clock time (YYYY-MM-DD + HH:MM) in `tz`, as RFC 3339 UTC. DST-safe. */
export function zonedToUtc(day: string, hhmm: string, tz: string) {
  const [y, m, d] = day.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi)
  let ms = wall - tzOffset(wall, tz)
  ms = wall - tzOffset(ms, tz) // second pass: the offset at the result, not at the guess
  return new Date(ms).toISOString().replace(".000Z", "Z")
}
