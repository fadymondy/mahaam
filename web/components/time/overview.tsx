"use client"

// The "my time" overview: KPI cards (with the change against the previous period), the daily
// stacked chart by project, the time-by-project donut, recent entries (play = resume on the same
// task), top tasks, and the right rail (today, quick stats). Everything is derived from the
// period's timesheets (lib/time-range.ts); a metric the data can't back is not shown.
import { type ReactNode } from "react"
import { ArrowDownIcon, ArrowUpIcon, BotIcon, ClockIcon, ListChecksIcon, PlayIcon, ReceiptTextIcon, SquareIcon, TargetIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"

import { Button, type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { ColorDot, solid } from "@/components/work/palette"
import { useTranslations } from "@/lib/i18n"
import { clock, dayLabel, entrySeconds, timeIn, weekdayShort, type TimeEntry } from "@/lib/time"
import { daysOf, delta, dur, isAgent, NONE, type Bucket, type Part, type Period, type RangeKind, type Stats } from "@/lib/time-range"
import { cn } from "@/lib/utils"

const hours = (s: number) => Math.round((s / 3600) * 100) / 100

function Panel({ title, action, children, className, ...rest }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <section className={cn("flex h-full min-w-0 flex-col border border-border bg-card", className)} {...rest}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </section>
  )
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const { t } = useTranslations()
  const d = delta(cur, prev)
  if (d === null) return <span className="text-xs text-muted-foreground">{t("time.ov.noPrev")}</span>
  const up = d > 0
  const down = d < 0
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up && "text-nq-success-text", down && "text-nq-danger-text", !up && !down && "text-muted-foreground")} data-delta={d}>
      {up ? <ArrowUpIcon className="size-3.5" /> : down ? <ArrowDownIcon className="size-3.5" /> : null}
      <Ltr className="tabular-nums">{Math.abs(d)}%</Ltr>
    </span>
  )
}

function Kpi({ icon, label, value, delta: dl, sub, data }: { icon: ReactNode; label: string; value: string; delta: ReactNode; sub: ReactNode; data: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 border border-border bg-card p-4" data-kpi={data}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center bg-muted text-muted-foreground [&_svg]:size-4">{icon}</span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <Ltr className="whitespace-nowrap text-2xl font-semibold tabular-nums" data-kpi-value>
          {value}
        </Ltr>
        <span className="shrink-0">{dl}</span>
      </div>
      <p className="mt-auto text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

export type OverviewProps = {
  kind: RangeKind
  period: Period
  cur: Stats
  prev: Stats
  parts: Part[]
  tz: string
  now: number
  today: string
  todaySeconds: number
  todayEntries: number
  running: TimeEntry | null
  canTrack: boolean
  busy: boolean
  onResume: (e: TimeEntry) => void
  onStop: () => void
  onOpenLog: () => void
}

export function TimeOverview(p: OverviewProps) {
  const { t, locale, isRtl } = useTranslations()
  const { cur, prev } = p
  const share = (n: number) => (cur.total ? Math.round((n / cur.total) * 100) : 0)
  const period = t(p.kind === "week" ? "time.ov.periodWeek" : "time.ov.periodMonth")

  // Chart series: the top projects keep their own colour, the rest fold into "other".
  const TOP = 5
  const top = cur.projects.slice(0, TOP)
  const rest = cur.projects.slice(TOP)
  const series = [...top, ...(rest.length ? [{ key: "__other", name: t("time.ov.other"), color: null, seconds: rest.reduce((a, b) => a + b.seconds, 0) } as Bucket] : [])]
  const sid = (i: number) => `s${i}`
  const label = (b: Bucket) => b.name ?? t("time.noProject")
  const config = Object.fromEntries(series.map((b, i) => [sid(i), { label: label(b), color: solid(b.color) }])) satisfies ChartConfig
  const topKeys = new Map(top.map((b, i) => [b.key, i]))
  const days = daysOf(p.period)
  const data = days.map((d) => {
    const row: Record<string, number | string> = { day: d }
    const dp = cur.dayProject.get(d)
    series.forEach((_, i) => (row[sid(i)] = 0))
    for (const [pk, s] of dp ?? []) {
      const i = topKeys.get(pk) ?? series.length - 1
      row[sid(i)] = hours(Number(row[sid(i)]) + s)
    }
    return row
  })
  const long = p.kind === "month"

  const recent: Part[] = []
  const seen = new Set<string>()
  for (const x of [...p.parts].sort((a, b) => b.slice.start.localeCompare(a.slice.start))) {
    if (seen.has(x.entry.id)) continue
    seen.add(x.entry.id)
    recent.push(x)
    if (recent.length === 6) break
  }

  const topTasks = cur.tasksTop.slice(0, 6)
  const bestProject = cur.projects[0]
  const avg = cur.activeDays ? cur.total / cur.activeDays : 0

  return (
    <div className="grid gap-6 px-6 pb-8 xl:grid-cols-[minmax(0,1fr)_20rem]" data-time-overview>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4" data-time-totals>
          <Kpi
            data="total"
            icon={<ClockIcon />}
            label={t("time.total")}
            value={dur(cur.total)}
            delta={<Delta cur={cur.total} prev={prev.total} />}
            sub={t("time.ov.vsPrev", { period, value: dur(prev.total) })}
          />
          <Kpi
            data="billable"
            icon={<ReceiptTextIcon />}
            label={t("time.billable")}
            value={dur(cur.billable)}
            delta={<Delta cur={cur.billable} prev={prev.billable} />}
            sub={t("time.ov.ofTotal", { pct: share(cur.billable) })}
          />
          <Kpi
            data="entries"
            icon={<ListChecksIcon />}
            label={t("time.entries")}
            value={String(cur.entries)}
            delta={<Delta cur={cur.entries} prev={prev.entries} />}
            sub={t("time.ov.tasks", { n: cur.tasks })}
          />
          <Kpi
            data="agent"
            icon={<BotIcon />}
            label={t("time.ov.agent")}
            value={dur(cur.agent)}
            delta={<Delta cur={cur.agent} prev={prev.agent} />}
            sub={t("time.ov.ofTotal", { pct: share(cur.agent) })}
          />
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <Panel title={t("time.ov.distribution")} data-panel="daily">
            {cur.total === 0 ? (
              <p className="m-auto text-sm text-muted-foreground">{t("time.noTime")}</p>
            ) : (
              <>
                <ChartContainer config={config} className="aspect-auto h-64 w-full" role="img" aria-label={t("time.ov.distribution")} data-daily-chart={days.length}>
                  <BarChart data={data} margin={{ top: 8, left: 4, right: 4, bottom: 0 }} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="day"
                      reversed={isRtl}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={long ? 14 : 4}
                      tickFormatter={(d: string) => (long ? String(Number(d.slice(8))) : weekdayShort(d, locale))}
                    />
                    <YAxis orientation={isRtl ? "right" : "left"} tickLine={false} axisLine={false} width={36} allowDecimals={false} tickFormatter={(v: number) => `${v}h`} />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent config={config} labelFormatter={(l) => (l ? dayLabel(String(l), locale, "long") : "")} valueFormat={{ maximumFractionDigits: 2 }} />}
                    />
                    {series.map((b, i) => (
                      <Bar key={b.key} dataKey={sid(i)} stackId="h" fill={`var(--color-${sid(i)})`} isAnimationActive={false} maxBarSize={32} />
                    ))}
                  </BarChart>
                </ChartContainer>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" data-chart-legend>
                  {series.map((b) => (
                    <li key={b.key} className="flex items-center gap-1.5">
                      <ColorDot color={b.color} />
                      <span className="max-w-32 truncate">{label(b)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title={t("time.ov.byProject")} data-panel="donut">
            {cur.total === 0 ? (
              <p className="m-auto text-sm text-muted-foreground">{t("time.noTime")}</p>
            ) : (
              <div className="flex flex-1 flex-col items-center gap-4">
                <div className="relative size-44 shrink-0">
                  <ChartContainer config={config} className="aspect-square size-44">
                    <PieChart>
                      <Pie data={series.map((b, i) => ({ name: label(b), value: b.seconds, key: sid(i) }))} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} strokeWidth={2} isAnimationActive={false}>
                        {series.map((b) => (
                          <Cell key={b.key} fill={solid(b.color)} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <Ltr className="text-lg font-semibold tabular-nums">{dur(cur.total)}</Ltr>
                    <span className="text-xs text-muted-foreground">{t("time.total")}</span>
                  </div>
                </div>
                <ul className="w-full min-w-0 flex-1 text-sm" data-project-legend>
                  {series.map((b) => (
                    <li key={b.key} className="grid grid-cols-[auto_minmax(0,1fr)_4.5rem_2.5rem] items-center gap-x-2 py-1.5">
                      <ColorDot color={b.color} />
                      <span className="truncate">
                        <bdi>{label(b)}</bdi>
                      </span>
                      <Ltr className="text-end tabular-nums">{dur(b.seconds)}</Ltr>
                      <Ltr className="text-end text-xs text-muted-foreground tabular-nums">{share(b.seconds)}%</Ltr>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <Panel
            title={t("time.ov.recent")}
            data-panel="recent"
            action={
              <Button variant="ghost" size="sm" onClick={p.onOpenLog}>
                {t("time.ov.viewAll")}
              </Button>
            }
          >
            {recent.length === 0 ? (
              <p className="m-auto text-sm text-muted-foreground">{t("time.noTime")}</p>
            ) : (
              <ul className="-my-2 divide-y divide-border" data-recent>
                {recent.map(({ entry: e, slice }) => {
                  const running = !e.ended_at
                  return (
                    <li key={e.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_2rem] items-center gap-x-3 py-2.5" data-recent-entry={e.id}>
                      <span className="flex size-9 items-center justify-center text-muted-foreground" style={{ background: "color-mix(in srgb, " + solid(e.project_color) + " 22%, transparent)" }}>
                        {isAgent(e) ? <BotIcon className="size-4" /> : <ClockIcon className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{e.description || e.task_title || e.project_name || t("time.noProject")}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.project_name ?? t("time.noProject")}
                          {e.task_key ? (
                            <>
                              {" · "}
                              <Ltr>{e.task_key}</Ltr>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex w-28 flex-col items-end gap-0.5 text-end">
                        <Ltr className={cn("text-sm font-medium tabular-nums", running && "text-nq-accent-text")}>{running ? clock(entrySeconds(e, p.now)) : dur(slice.seconds)}</Ltr>
                        <span className="text-xs text-muted-foreground">
                          <Ltr className="tabular-nums">
                            {timeIn(slice.start, p.tz)}–{running ? "…" : timeIn(slice.end, p.tz)}
                          </Ltr>
                        </span>
                      </div>
                      {p.canTrack ? (
                        running && !isAgent(e) ? (
                          <Button size="icon-sm" variant="primary" aria-label={t("timer.stopTimer")} title={t("timer.stopTimer")} disabled={p.busy} onClick={p.onStop}>
                            <SquareIcon />
                          </Button>
                        ) : (
                          <Button size="icon-sm" variant="secondary" aria-label={t("time.ov.resume")} title={t("time.ov.resume")} disabled={p.busy || running} onClick={() => p.onResume(e)} data-resume={e.id}>
                            <PlayIcon />
                          </Button>
                        )
                      ) : (
                        <span />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel title={t("time.ov.topTasks")} data-panel="top">
            {topTasks.length === 0 ? (
              <p className="m-auto text-sm text-muted-foreground">{t("time.noTime")}</p>
            ) : (
              <ul className="-my-2 divide-y divide-border" data-top-tasks>
                {topTasks.map((b) => (
                  <li key={b.key} className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,6rem)_3.75rem_2.5rem] items-center gap-x-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className={cn("block truncate", !b.name && "text-muted-foreground")}>
                        <bdi>{b.name ?? t("time.noProject")}</bdi>
                      </span>
                      {b.taskKey || b.projectName ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {b.taskKey ? <Ltr>{b.taskKey}</Ltr> : null}
                          {b.taskKey && b.projectName ? " · " : ""}
                          {b.projectName}
                        </span>
                      ) : null}
                    </span>
                    <span className="h-1.5 w-full bg-muted" aria-hidden>
                      <span className="block h-full" style={{ width: `${share(b.seconds)}%`, background: solid(b.color) }} />
                    </span>
                    <Ltr className="text-end tabular-nums">{dur(b.seconds)}</Ltr>
                    <Ltr className="text-end text-xs text-muted-foreground tabular-nums">{share(b.seconds)}%</Ltr>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-6" data-time-rail>
        <Panel title={t("time.ov.todayFocus")} className="h-auto" data-panel="today">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center bg-muted text-muted-foreground">
              <TargetIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <Ltr className="block text-2xl font-semibold tabular-nums" data-today-total>
                {dur(p.todaySeconds)}
              </Ltr>
              <p className="text-xs text-muted-foreground">{t("time.ov.todayEntries", { n: p.todayEntries })}</p>
            </div>
          </div>
          {p.running ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{p.running.task_title ?? p.running.project_name ?? t("timer.running")}</span>
              <Ltr mono className="shrink-0 text-nq-accent-text tabular-nums">
                {clock(entrySeconds(p.running, p.now))}
              </Ltr>
            </div>
          ) : null}
        </Panel>

        <Panel title={t("time.ov.quick")} className="h-auto" data-panel="quick">
          <dl className="-my-2 divide-y divide-border text-sm" data-quick-stats>
            <QuickRow label={t("time.ov.dailyAvg")} value={cur.activeDays ? dur(avg) : "—"} />
            <QuickRow label={t("time.ov.bestDay")} value={cur.bestDay ? `${dayLabel(cur.bestDay.day, locale)} · ${dur(cur.bestDay.seconds)}` : "—"} />
            <QuickRow label={t("time.ov.topProject")} value={bestProject ? `${bestProject.key === NONE ? t("time.noProject") : bestProject.name} · ${share(bestProject.seconds)}%` : "—"} />
            <QuickRow label={t("time.ov.activeDays")} value={<Ltr>{`${cur.activeDays} / ${days.length}`}</Ltr>} />
          </dl>
        </Panel>
      </aside>
    </div>
  )
}

function QuickRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 max-w-44 truncate text-end font-medium tabular-nums">{value}</dd>
    </div>
  )
}
