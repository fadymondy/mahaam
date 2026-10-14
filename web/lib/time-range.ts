"use client"

// "My time" over a week or a month: ONE request (/api/w/time/range) returns the period's entries
// cut at workspace-local midnight plus the period before it (for the deltas), and this file holds the
// pure aggregation the overview, log and charts share. Every number comes from those slices, so the
// cards, the charts and the week grid always agree.
import useSWR from "swr"

import { api, ApiError } from "@/lib/api"
import { addDays, type EntrySlice, type TimeEntry } from "@/lib/time"

export type RangeKind = "week" | "month"
export type SourceFilter = "all" | "human" | "agent"

export type Period = { from: string; to: string }

/** Mirror of internal/work/timerange.go. */
export type RangeData = {
  user_id: string
  timezone: string
  week_start: number
  rounding_minutes: number
  kind: RangeKind
  current: Period
  previous: Period
  entries: TimeEntry[]
  slices: EntrySlice[]
  running: TimeEntry | null
  now: string
}

const opts = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
  keepPreviousData: true,
}

/** The key starts with /api/w/time/ so useRefreshTime and the live stream revalidate it like every other time view. */
export function useRangeData(ws: string, kind: RangeKind, ref: string | null, user: string | null) {
  const q = new URLSearchParams({ kind })
  if (ref) q.set("ref", ref)
  if (user) q.set("user", user)
  return useSWR<RangeData>(ws ? [`/api/w/time/range?${q}`, ws] : null, ([p, id]: [string, string]) => api<RangeData>(p, { workspaceId: id }), opts)
}

/** The reference day one period earlier / later, for the navigation. */
export function shiftRef(kind: RangeKind, ref: string, dir: -1 | 1) {
  if (kind === "week") return addDays(ref, dir * 7)
  const d = new Date(ref.slice(0, 8) + "01T00:00:00Z")
  d.setUTCMonth(d.getUTCMonth() + dir, 1)
  return d.toISOString().slice(0, 10)
}

// ── aggregation ──────────────────────────────────────────────────────────────

export type Part = { slice: EntrySlice; entry: TimeEntry }

const inPeriod = (day: string, p: Period) => day >= p.from && day <= p.to
export const isAgent = (e: TimeEntry) => e.source === "mcp"

/** Every slice of the period with its entry, after the source filter. */
export function partsOf(data: Pick<RangeData, "entries" | "slices">, p: Period, source: SourceFilter): Part[] {
  const entries = new Map(data.entries.map((e) => [e.id, e]))
  const out: Part[] = []
  for (const slice of data.slices) {
    const entry = entries.get(slice.entry_id)
    if (!entry || !inPeriod(slice.day, p)) continue
    if (source === "human" && isAgent(entry)) continue
    if (source === "agent" && !isAgent(entry)) continue
    out.push({ slice, entry })
  }
  return out
}

export const NONE = "none"
export const projectKey = (e: TimeEntry) => e.project_id ?? NONE

export type Bucket = { key: string; name: string | null; color: string | null; seconds: number }

export type Stats = {
  total: number
  billable: number
  agent: number
  entries: number
  tasks: number
  activeDays: number
  byDay: Map<string, number>
  dayProject: Map<string, Map<string, number>>
  projects: Bucket[]
  tasksTop: (Bucket & { taskKey: string | null; projectName: string | null })[]
  bestDay: { day: string; seconds: number } | null
}

export function statsOf(parts: Part[]): Stats {
  const byDay = new Map<string, number>()
  const dayProject = new Map<string, Map<string, number>>()
  const projects = new Map<string, Bucket>()
  const tasks = new Map<string, Stats["tasksTop"][number]>()
  const entryIds = new Set<string>()
  let total = 0
  let billable = 0
  let agent = 0
  for (const { slice, entry } of parts) {
    const s = slice.seconds
    total += s
    if (entry.billable) billable += s
    if (isAgent(entry)) agent += s
    entryIds.add(entry.id)
    byDay.set(slice.day, (byDay.get(slice.day) ?? 0) + s)
    const pk = projectKey(entry)
    const dp = dayProject.get(slice.day) ?? new Map<string, number>()
    dp.set(pk, (dp.get(pk) ?? 0) + s)
    dayProject.set(slice.day, dp)
    const pb = projects.get(pk) ?? { key: pk, name: entry.project_name, color: entry.project_color, seconds: 0 }
    pb.seconds += s
    projects.set(pk, pb)
    const tk = entry.task_id ?? `p:${pk}`
    const tb = tasks.get(tk) ?? { key: tk, name: entry.task_title ?? entry.project_name, color: entry.project_color, seconds: 0, taskKey: entry.task_key, projectName: entry.project_name }
    tb.seconds += s
    tasks.set(tk, tb)
  }
  let bestDay: Stats["bestDay"] = null
  for (const [day, seconds] of byDay) if (!bestDay || seconds > bestDay.seconds) bestDay = { day, seconds }
  const byTime = <T extends { seconds: number }>(a: T, b: T) => b.seconds - a.seconds
  return {
    total,
    billable,
    agent,
    entries: entryIds.size,
    tasks: new Set(parts.map((p) => p.entry.task_id).filter(Boolean)).size,
    activeDays: byDay.size,
    byDay,
    dayProject,
    projects: [...projects.values()].sort(byTime),
    tasksTop: [...tasks.values()].sort(byTime),
    bestDay,
  }
}

/** Percent change from `prev` to `cur`; null when there is nothing to compare with. */
export function delta(cur: number, prev: number) {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

/** Every day from..to, for the chart's x axis. */
export function daysOf(p: Period) {
  const out: string[] = []
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) out.push(d)
  return out
}

/** "2h 30m" — a duration read at a glance (Latin digits; render inside <Ltr>). */
export function dur(sec: number) {
  const m = Math.round(sec / 60)
  const h = Math.floor(m / 60)
  const r = m % 60
  if (!h) return `${r}m`
  return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`
}
