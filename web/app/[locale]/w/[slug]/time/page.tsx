"use client"

// My timesheet: the week grid (project/task x day) and the day list with manual entries. Days are
// cut at midnight in the WORKSPACE timezone by the server (a 23:00–01:00 entry shows an hour on each
// day). A manager opens a member's week with ?user=. Every tab updates live (per-user stream).
import Link from "next/link"
import { Suspense, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { BotIcon, LockIcon, PencilIcon, PlusIcon, SquareIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { EntryForm } from "@/components/time/entry-form"
import { useTimerActions } from "@/components/time/timer-bar"
import { WeekNav } from "@/components/time/week-nav"
import { ColorDot } from "@/components/work/palette"
import { useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import {
  clock,
  dayIn,
  dayLabel,
  entrySeconds,
  hm,
  timeApi,
  timeIn,
  useNow,
  useRefreshTime,
  useTimesheet,
  weekdayShort,
  type EntrySlice,
  type TimeEntry,
  type TimesheetRow,
} from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import { errorText } from "@/lib/work"

export default function TimePage() {
  return (
    <Suspense>
      <TimeView />
    </Suspense>
  )
}

const rowKey = (r: { project_id: string | null; task_id: string | null }) => `${r.project_id ?? ""}|${r.task_id ?? ""}`

function Stat({ label, children, data }: { label: string; children: ReactNode; data?: string }) {
  return (
    <div className="flex flex-col gap-1 border-line px-6 py-4 max-md:border-b max-md:odd:border-e md:border-e md:last:border-e-0" data-stat={data}>
      <dt className="grid-micro">{label}</dt>
      <dd className="text-xl font-medium tabular-nums">{children}</dd>
    </div>
  )
}

function TimeView() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const me = useMe()
  const myId = me.data ? String(me.data.id) : ""
  const dir = useDirectory(myId || undefined)
  const userParam = params.get("user")
  const viewingOther = !!userParam && !!myId && userParam !== myId
  const title = viewingOther ? t("time.titleOf", { name: dir.name(userParam) }) : t("time.title")
  useDocumentTitle(`${title} · ${ws.summary.name}`)

  const canTrack = ws.can("time:track")
  const sheet = useTimesheet(canTrack ? ws.id : "", params.get("week"), viewingOther ? userParam : null)
  const refresh = useRefreshTime()
  const { stop: stopMine, busy } = useTimerActions()
  const ts = sheet.data
  const tz = ts?.timezone ?? ws.current?.workspace.timezone ?? "UTC"
  const now = useNow(1000, !!ts?.running)
  const [picked, setPicked] = useState<string | null>(null)
  const [editing, setEditing] = useState<TimeEntry | "new" | null>(null)

  if (ws.current && !canTrack) return <p className="px-6 py-6 text-sm text-grid-muted">{t("time.noPermission")}</p>

  function setQuery(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    const s = q.toString()
    router.replace(`${pathname}${s ? `?${s}` : ""}`)
  }

  const days = ts?.days ?? []
  const today = dayIn(now, tz)
  const selected = picked && days.includes(picked) ? picked : days.includes(today) ? today : (days[0] ?? today)

  // The running entry keeps growing on today's cell after the sheet was fetched.
  const drift = ts?.running ? Math.max(0, Math.floor((now - Date.parse(ts.now)) / 1000)) : 0
  const runDay = ts?.running ? days.indexOf(today) : -1
  const runKey = ts?.running ? rowKey(ts.running) : ""
  const cell = (row: TimesheetRow, i: number) => row.seconds[i] + (i === runDay && rowKey(row) === runKey ? drift : 0)
  const dayTotal = (i: number) => (ts ? ts.day_totals[i] + (i === runDay ? drift : 0) : 0)
  const total = ts ? ts.total_s + (runDay >= 0 ? drift : 0) : 0

  const byId = new Map((ts?.entries ?? []).map((e) => [e.id, e]))
  const daySlices: { slice: EntrySlice; entry: TimeEntry }[] = (ts?.slices ?? [])
    .filter((s) => s.day === selected)
    .map((s) => ({ slice: s, entry: byId.get(s.entry_id)! }))
    .filter((x) => x.entry)
    .sort((a, b) => a.slice.start.localeCompare(b.slice.start))

  const mayEdit = (e: TimeEntry) => !e.locked && (e.user_id === myId || ws.can("time:manage"))

  async function remove(e: TimeEntry) {
    try {
      await timeApi.remove(ws.id, e.id)
      toast.success(t("time.deleted"))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
    void sheet.mutate()
    void refresh(ws.id)
  }

  async function stop() {
    if (viewingOther && userParam) {
      try {
        await timeApi.stop(ws.id, userParam)
        toast.success(t("timer.stopped"))
      } catch (err) {
        toast.error(errorText(err, t("common.networkError")))
      }
    } else await stopMine()
    void sheet.mutate()
    void refresh(ws.id)
  }

  const label = (r: { project_name: string | null; task_key: string | null; task_title: string | null }) =>
    r.task_key ? (
      <span className="flex min-w-0 items-center gap-2">
        <Ltr mono className="shrink-0 text-xs text-grid-muted">
          {r.task_key}
        </Ltr>
        <span className="truncate">{r.task_title}</span>
      </span>
    ) : (
      <span className={cn("truncate", !r.project_name && "text-grid-muted")}>{r.project_name ?? t("time.noProject")}</span>
    )

  return (
    <>
      <SectionHeader
        micro={
          viewingOther ? (
            <Link href={`/${locale}/w/${ws.slug}/time`} className="underline-offset-4 hover:underline">
              {t("time.backToMine")}
            </Link>
          ) : (
            ws.summary.name
          )
        }
        title={title}
        description={t(viewingOther ? "time.hintOf" : "time.hint", { tz })}
        action={<WeekNav days={ts?.days} isCurrent={days.includes(today)} onWeek={(ref) => setQuery({ week: ref })} />}
      />

      {sheet.error ? (
        <ErrorState error={sheet.error} />
      ) : !ts ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <dl className="grid grid-cols-2 border-t border-line md:grid-cols-4" data-time-totals>
            <Stat label={t("time.total")} data="total">
              <Ltr mono>{hm(total, "0:00")}</Ltr>
            </Stat>
            <Stat label={t("time.billable")} data="billable">
              <Ltr mono>{hm(ts.billable_s, "0:00")}</Ltr>
            </Stat>
            <Stat label={ts.rounding_minutes ? t("time.rounded", { minutes: ts.rounding_minutes }) : t("timeSettings.roundingNone")} data="rounded">
              <Ltr mono>{hm(ts.rounded_total_s, "0:00")}</Ltr>
            </Stat>
            <Stat label={t("time.runningNow")} data="running">
              {ts.running ? (
                <Ltr mono className="text-grid-action">
                  {clock(entrySeconds(ts.running, now))}
                </Ltr>
              ) : (
                <span className="text-grid-muted">—</span>
              )}
            </Stat>
          </dl>

          {/* The week grid: desktop. Below md the day strip + day list carry the same data. */}
          <section className="hidden border-t border-line md:block" data-week-grid aria-label={t("time.grid")}>
            {ts.rows.length === 0 ? (
              <EmptyState title={t("time.noTime")} body={t("time.noTimeBody")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6">{t("time.project")}</TableHead>
                    {days.map((d) => (
                      <TableHead key={d} className={cn("w-[8%] text-end", d === today && "text-grid-fg")}>
                        <span className="block text-xs font-normal text-grid-muted">{weekdayShort(d, locale)}</span>
                        <Ltr>{Number(d.slice(8))}</Ltr>
                      </TableHead>
                    ))}
                    <TableHead className="w-[9%] pe-6 text-end">{t("time.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ts.rows.map((r) => (
                    <TableRow key={rowKey(r)} data-grid-row={rowKey(r)}>
                      <TableCell className="max-w-0 ps-6">
                        <span className="flex min-w-0 items-center gap-2">
                          <ColorDot color={r.project_color} />
                          <span className="min-w-0">
                            {label(r)}
                            {r.task_key && r.project_name ? <span className="block truncate text-meta text-grid-muted">{r.project_name}</span> : null}
                          </span>
                        </span>
                      </TableCell>
                      {days.map((d, i) => (
                        <TableCell key={d} className={cn("text-end tabular-nums", d === today && "bg-grid-soft/60")}>
                          <Ltr mono className={cell(r, i) ? "" : "text-grid-line"} data-cell={d}>
                            {hm(cell(r, i), "·")}
                          </Ltr>
                        </TableCell>
                      ))}
                      <TableCell className="pe-6 text-end font-medium tabular-nums">
                        <Ltr mono>{hm(r.total_s + (rowKey(r) === runKey ? drift : 0), "0:00")}</Ltr>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="ps-6 font-medium">{t("time.dayTotal")}</TableCell>
                    {days.map((d, i) => (
                      <TableCell key={d} className="text-end font-medium tabular-nums" data-day-total={d}>
                        <Ltr mono>{hm(dayTotal(i), "0:00")}</Ltr>
                      </TableCell>
                    ))}
                    <TableCell className="pe-6 text-end font-semibold tabular-nums">
                      <Ltr mono>{hm(total, "0:00")}</Ltr>
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </section>

          <div className="grid grid-cols-7 border-y border-line" role="tablist" aria-label={t("time.grid")} data-day-strip>
            {days.map((d, i) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === selected}
                onClick={() => setPicked(d)}
                data-day={d}
                className={cn(
                  "flex flex-col items-center gap-0.5 border-e border-line px-1 py-2 text-center transition-colors last:border-e-0 hover:bg-grid-soft",
                  d === selected ? "bg-grid-soft shadow-[inset_0_-2px_0_var(--grid-action)]" : "",
                )}
              >
                <span className={cn("text-xs", d === today ? "font-medium text-grid-action" : "text-grid-muted")}>{weekdayShort(d, locale)}</span>
                <Ltr className="text-sm font-medium">{Number(d.slice(8))}</Ltr>
                <Ltr mono className="text-xs text-grid-muted">
                  {hm(dayTotal(i), "–")}
                </Ltr>
              </button>
            ))}
          </div>

          <section data-day-list={selected}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
              <h2 className="text-sm font-medium">{dayLabel(selected, locale, "long")}</h2>
              <Button size="sm" onClick={() => setEditing("new")} data-add-time>
                <PlusIcon />
                {t("time.add")}
              </Button>
            </div>
            {daySlices.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-grid-muted">{t("time.noEntriesDay")}</p>
            ) : (
              <ul className="divide-y divide-line border-b border-line">
                {daySlices.map(({ slice, entry: e }) => {
                  const running = !e.ended_at
                  const fromPrev = slice.start !== new Date(e.started_at).toISOString().replace(".000Z", "Z") && Date.parse(slice.start) > Date.parse(e.started_at)
                  const continues = !running && e.ended_at && Date.parse(slice.end) < Date.parse(e.ended_at)
                  return (
                    <li
                      key={e.id + slice.day}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 md:flex-nowrap"
                      data-entry={e.id}
                      data-entry-source={e.source}
                      data-entry-running={running ? "true" : "false"}
                    >
                      <Ltr mono className="w-28 shrink-0 text-sm tabular-nums" data-entry-range>
                        {timeIn(slice.start, tz)}–{running ? "…" : timeIn(slice.end, tz)}
                      </Ltr>
                      <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1">
                        <p className={cn("truncate text-sm", !e.description && "text-grid-muted")}>{e.description || t("time.descriptionPlaceholder")}</p>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-grid-muted">
                          <ColorDot color={e.project_color} />
                          {label(e)}
                          {e.task_key && e.project_name ? <span className="truncate">· {e.project_name}</span> : null}
                          {fromPrev ? <Badge variant="outline">{t("time.fromPrev")}</Badge> : null}
                          {continues ? <Badge variant="outline">{t("time.continues")}</Badge> : null}
                          {e.billable ? <Badge variant="secondary">{t("time.billable")}</Badge> : null}
                        </div>
                      </div>
                      <span className="hidden w-24 shrink-0 text-meta text-grid-muted md:block">
                        {e.source === "mcp" ? (
                          <span className="inline-flex items-center gap-1">
                            <BotIcon className="size-3.5" />
                            {t("time.source.mcp")}
                          </span>
                        ) : (
                          t(`time.source.${e.source}`)
                        )}
                      </span>
                      <Ltr mono className={cn("ms-auto w-16 shrink-0 text-end text-sm tabular-nums md:ms-0", running && "text-grid-action")} data-entry-duration>
                        {running ? clock(entrySeconds(e, now)) : hm(slice.seconds, "0:00")}
                      </Ltr>
                      <div className="flex w-24 shrink-0 justify-end gap-0.5">
                        {e.locked ? (
                          <span title={t("time.locked")} aria-label={t("time.locked")} className="p-1.5 text-grid-muted">
                            <LockIcon className="size-4" />
                          </span>
                        ) : null}
                        {running ? (
                          <Button size="icon-sm" variant="ghost" aria-label={t("timer.stopTimer")} title={t("timer.stopTimer")} disabled={busy} onClick={stop}>
                            <SquareIcon />
                          </Button>
                        ) : null}
                        {mayEdit(e) ? (
                          <>
                            <Button size="icon-sm" variant="ghost" aria-label={t("time.edit")} title={t("time.edit")} onClick={() => setEditing(e)} data-edit-entry={e.id}>
                              <PencilIcon />
                            </Button>
                            <ConfirmButton
                              label={<span className="sr-only md:not-sr-only">{t("time.delete")}</span>}
                              title={t("time.deleteTitle")}
                              description={t("time.deleteBody")}
                              confirmLabel={t("time.delete")}
                              onConfirm={() => remove(e)}
                            />
                          </>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("time.add") : t("time.editTitle")}</DialogTitle>
            <DialogDescription>{dayLabel(editing && editing !== "new" ? dayIn(editing.started_at, tz) : selected, locale, "long")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <EntryForm
              entry={editing === "new" ? undefined : editing}
              day={selected}
              tz={tz}
              user={viewingOther ? userParam : null}
              onDone={() => {
                setEditing(null)
                void sheet.mutate()
                void refresh(ws.id)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
