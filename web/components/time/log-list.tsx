"use client"

// The timesheet log: every entry of the period, a day at a time (newest first), with manual entry,
// edit, delete and stop. Entries that cross midnight show one row per day, as the server cuts them.
import { BotIcon, LockIcon, PencilIcon, PlusIcon, SquareIcon } from "lucide-react"

import { Badge, Button } from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { ColorDot } from "@/components/work/palette"
import { useTranslations } from "@/lib/i18n"
import { clock, dayLabel, entrySeconds, hm, timeIn, type TimeEntry } from "@/lib/time"
import type { Part } from "@/lib/time-range"
import { cn } from "@/lib/utils"

export function LogList({
  parts,
  tz,
  now,
  today,
  mayEdit,
  busy,
  onAdd,
  onEdit,
  onRemove,
  onStop,
}: {
  parts: Part[]
  tz: string
  now: number
  today: string
  mayEdit: (e: TimeEntry) => boolean
  busy: boolean
  onAdd: (day: string) => void
  onEdit: (e: TimeEntry) => void
  onRemove: (e: TimeEntry) => Promise<void>
  onStop: () => void
}) {
  const { t, locale } = useTranslations()
  const byDay = new Map<string, Part[]>()
  for (const x of parts) byDay.set(x.slice.day, [...(byDay.get(x.slice.day) ?? []), x])
  // Today is always listed so there is somewhere to add time even on an empty day.
  if (!byDay.has(today) && parts.length === 0) byDay.set(today, [])
  const days = [...byDay.keys()].sort().reverse()

  return (
    <div className="flex flex-col gap-6 px-6 pb-8" data-time-log>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => onAdd(days.includes(today) ? today : (days[0] ?? today))} data-add-time>
          <PlusIcon />
          {t("time.add")}
        </Button>
      </div>
      {days.length === 0 ? <p className="border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">{t("time.noEntriesDay")}</p> : null}
      {days.map((d) => {
        const rows = byDay.get(d)!.sort((a, b) => a.slice.start.localeCompare(b.slice.start))
        const total = rows.reduce((a, r) => a + r.slice.seconds, 0)
        return (
          <section key={d} className="border border-border bg-card" data-day-list={d}>
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-medium">{dayLabel(d, locale, "long")}</h2>
              <div className="flex items-center gap-3">
                <Ltr mono className="text-sm tabular-nums text-muted-foreground" data-day-total={d}>
                  {hm(total, "0:00")}
                </Ltr>
                <Button size="icon-sm" variant="ghost" aria-label={t("time.add")} title={t("time.add")} onClick={() => onAdd(d)}>
                  <PlusIcon />
                </Button>
              </div>
            </header>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("time.noEntriesDay")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map(({ slice, entry: e }) => {
                  const running = !e.ended_at
                  const fromPrev = Date.parse(slice.start) > Date.parse(e.started_at)
                  const continues = !running && e.ended_at && Date.parse(slice.end) < Date.parse(e.ended_at)
                  return (
                    <li
                      key={e.id + slice.day}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 md:flex-nowrap"
                      data-entry={e.id}
                      data-entry-source={e.source}
                      data-entry-running={running ? "true" : "false"}
                    >
                      <Ltr mono className="w-28 shrink-0 text-sm tabular-nums" data-entry-range>
                        {timeIn(slice.start, tz)}–{running ? "…" : timeIn(slice.end, tz)}
                      </Ltr>
                      <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1">
                        <p className={cn("truncate text-sm", !e.description && "text-muted-foreground")}>{e.description || t("time.descriptionPlaceholder")}</p>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                          <ColorDot color={e.project_color} />
                          {e.task_key ? (
                            <Ltr mono className="text-xs">
                              {e.task_key}
                            </Ltr>
                          ) : null}
                          <span className="truncate">{e.task_title ?? e.project_name ?? t("time.noProject")}</span>
                          {e.task_key && e.project_name ? <span className="truncate">· {e.project_name}</span> : null}
                          {fromPrev ? <Badge variant="outline">{t("time.fromPrev")}</Badge> : null}
                          {continues ? <Badge variant="outline">{t("time.continues")}</Badge> : null}
                          {e.billable ? <Badge variant="neutral">{t("time.billable")}</Badge> : null}
                        </div>
                      </div>
                      <span className="hidden w-24 shrink-0 text-caption text-muted-foreground md:block">
                        {e.source === "mcp" ? (
                          <span className="inline-flex items-center gap-1">
                            <BotIcon className="size-3.5" />
                            {t("time.source.mcp")}
                          </span>
                        ) : (
                          t(`time.source.${e.source}`)
                        )}
                      </span>
                      <Ltr mono className={cn("ms-auto w-16 shrink-0 text-end text-sm tabular-nums md:ms-0", running && "text-nq-accent-text")} data-entry-duration>
                        {running ? clock(entrySeconds(e, now)) : hm(slice.seconds, "0:00")}
                      </Ltr>
                      <div className="flex w-24 shrink-0 justify-end gap-0.5">
                        {e.locked ? (
                          <span title={t("time.locked")} aria-label={t("time.locked")} className="p-1.5 text-muted-foreground">
                            <LockIcon className="size-4" />
                          </span>
                        ) : null}
                        {running ? (
                          <Button size="icon-sm" variant="ghost" aria-label={t("timer.stopTimer")} title={t("timer.stopTimer")} disabled={busy} onClick={onStop}>
                            <SquareIcon />
                          </Button>
                        ) : null}
                        {mayEdit(e) ? (
                          <>
                            <Button size="icon-sm" variant="ghost" aria-label={t("time.edit")} title={t("time.edit")} onClick={() => onEdit(e)} data-edit-entry={e.id}>
                              <PencilIcon />
                            </Button>
                            <ConfirmButton
                              label={<span className="sr-only md:not-sr-only">{t("time.delete")}</span>}
                              title={t("time.deleteTitle")}
                              description={t("time.deleteBody")}
                              confirmLabel={t("time.delete")}
                              onConfirm={() => onRemove(e)}
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
        )
      })}
    </div>
  )
}
