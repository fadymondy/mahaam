"use client"

// The week grid: project/task x day, one table per week of the period, built from the period's
// slices. A week that is cut by the period (a month's first and last) shows only the period's days.
// Scrolls sideways on a phone rather than dropping columns, so the numbers stay aligned.
import { Card, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { EmptyState } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useTranslations } from "@/lib/i18n"
import { addDays, dayIn, hm, weekdayShort, type TimeEntry } from "@/lib/time"
import type { Part, Period } from "@/lib/time-range"
import { cn } from "@/lib/utils"

type Line = { key: string; entry: TimeEntry; seconds: Map<string, number>; total: number }

const lineKey = (e: Pick<TimeEntry, "project_id" | "task_id">) => `${e.project_id ?? ""}|${e.task_id ?? ""}`

/** The weeks (starting on `weekStart`, 0 = Sunday) that touch the period, as their days inside it. */
function weeksOf(p: Period, weekStart: number) {
  const dow = new Date(p.from + "T00:00:00Z").getUTCDay()
  let d = addDays(p.from, -((dow - weekStart + 7) % 7))
  const weeks: string[][] = []
  while (d <= p.to) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)).filter((x) => x >= p.from && x <= p.to))
    d = addDays(d, 7)
  }
  return weeks
}

function WeekTable({ days, parts, running, drift, today }: { days: string[]; parts: Part[]; running: TimeEntry | null; drift: number; today: string }) {
  const { t, locale } = useTranslations()
  const lines = new Map<string, Line>()
  const dayTotal = new Map<string, number>()
  for (const { slice, entry } of parts) {
    if (!days.includes(slice.day)) continue
    const k = lineKey(entry)
    const line = lines.get(k) ?? { key: k, entry, seconds: new Map(), total: 0 }
    line.seconds.set(slice.day, (line.seconds.get(slice.day) ?? 0) + slice.seconds)
    line.total += slice.seconds
    lines.set(k, line)
    dayTotal.set(slice.day, (dayTotal.get(slice.day) ?? 0) + slice.seconds)
  }
  // The running entry keeps growing on today's cell after the data was fetched.
  const grows = !!running && parts.some((x) => x.entry.id === running.id) && days.includes(today)
  const runKey = grows ? lineKey(running) : ""
  const cell = (l: Line, d: string) => (l.seconds.get(d) ?? 0) + (grows && d === today && l.key === runKey ? drift : 0)
  const dayT = (d: string) => (dayTotal.get(d) ?? 0) + (grows && d === today ? drift : 0)
  const total = days.reduce((a, d) => a + dayT(d), 0)
  const rows = [...lines.values()].sort((a, b) => {
    const an = a.entry.project_name
    const bn = b.entry.project_name
    if (!an !== !bn) return an ? -1 : 1 // "no project" last
    return (an ?? "").localeCompare(bn ?? "") || (a.entry.task_key ?? "").localeCompare(b.entry.task_key ?? "")
  })

  const label = (e: TimeEntry) =>
    e.task_key ? (
      <span className="flex min-w-0 items-center gap-2">
        <Ltr mono className="shrink-0 text-xs text-muted-foreground">
          {e.task_key}
        </Ltr>
        <span className="truncate">
          <bdi>{e.task_title}</bdi>
        </span>
      </span>
    ) : (
      <span className={cn("truncate", !e.project_name && "text-muted-foreground")}>{e.project_name ?? t("time.noProject")}</span>
    )

  return (
    <div className="overflow-x-auto" data-week-grid={days[0]}>
      <Table className="min-w-[44rem] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28%] ps-4">{t("time.project")}</TableHead>
            {days.map((d) => (
              <TableHead key={d} className={cn("text-end", d === today && "text-foreground")}>
                <span className="block text-xs font-normal text-muted-foreground">{weekdayShort(d, locale)}</span>
                <Ltr>{Number(d.slice(8))}</Ltr>
              </TableHead>
            ))}
            <TableHead className="w-[10%] pe-4 text-end">{t("time.total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((l) => (
            <TableRow key={l.key} data-grid-row={l.key}>
              <TableCell className="ps-4">
                <span className="flex min-w-0 items-center gap-2">
                  <ColorDot color={l.entry.project_color} />
                  <span className="min-w-0">
                    {label(l.entry)}
                    {l.entry.task_key && l.entry.project_name ? <span className="block truncate text-caption text-muted-foreground">{l.entry.project_name}</span> : null}
                  </span>
                </span>
              </TableCell>
              {days.map((d) => (
                <TableCell key={d} className={cn("text-end tabular-nums", d === today && "bg-muted/60")}>
                  <Ltr mono className={cell(l, d) ? "" : "text-border"} data-cell={d}>
                    {hm(cell(l, d), "·")}
                  </Ltr>
                </TableCell>
              ))}
              <TableCell className="pe-4 text-end font-medium tabular-nums">
                <Ltr mono>{hm(l.total + (l.key === runKey ? drift : 0), "0:00")}</Ltr>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="ps-4 font-medium">{t("time.dayTotal")}</TableCell>
            {days.map((d) => (
              <TableCell key={d} className="text-end font-medium tabular-nums" data-day-total={d}>
                <Ltr mono>{hm(dayT(d), "0:00")}</Ltr>
              </TableCell>
            ))}
            <TableCell className="pe-4 text-end font-semibold tabular-nums">
              <Ltr mono>{hm(total, "0:00")}</Ltr>
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

export function WeekGrid({ parts, period, weekStart, running, fetchedAt, now, tz }: { parts: Part[]; period: Period; weekStart: number; running: TimeEntry | null; fetchedAt: string; now: number; tz: string }) {
  const { t } = useTranslations()
  const today = dayIn(now, tz)
  const drift = running ? Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 1000)) : 0
  const weeks = weeksOf(period, weekStart).filter((days) => parts.some((x) => days.includes(x.slice.day)))
  return (
    <div className="flex flex-col gap-6" data-time-weeks aria-label={t("time.grid")}>
      {weeks.length === 0 ? (
        <EmptyState title={t("time.noTime")} body={t("time.noTimeBody")} />
      ) : (
        weeks.map((days) => (
          <Card key={days[0]} className="gap-0 overflow-hidden py-0">
            {period.to > addDays(period.from, 7) ? (
              <header className="border-b border-border px-4 py-2.5 text-sm font-medium">
                <Ltr className="tabular-nums">
                  {days[0]} – {days[days.length - 1]}
                </Ltr>
              </header>
            ) : null}
            <WeekTable days={days} parts={parts} running={running} drift={drift} today={today} />
          </Card>
        ))
      )}
    </div>
  )
}
