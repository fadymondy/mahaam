"use client"

// My time: overview (KPIs, charts, recent, top tasks), the timesheet log with manual entry, the week
// grid, and the period's report. Days are cut at midnight in the WORKSPACE timezone by the server
// (a 23:00–01:00 entry shows an hour on each day). A manager opens a member's time with ?user=.
// The URL is the state: ?tab=&range=week|month&ref=&source=. Every tab updates live.
import { Suspense, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "@fadymondy/nasaq/web"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"

import { Page, PageHeader } from "@/components/page"
import { ErrorState, LoadingRows } from "@/components/states"
import { EntryForm } from "@/components/time/entry-form"
import { LogList } from "@/components/time/log-list"
import { TimeOverview } from "@/components/time/overview"
import { RangeNav } from "@/components/time/range-nav"
import { ReportsTab } from "@/components/time/reports-tab"
import { useTimerActions } from "@/components/time/timer-bar"
import { WeekGrid } from "@/components/time/week-grid"
import { useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { dayIn, dayLabel, timeApi, useNow, useRefreshTime, type TimeEntry } from "@/lib/time"
import { partsOf, shiftRef, statsOf, useRangeData, type RangeKind, type SourceFilter } from "@/lib/time-range"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

export default function TimePage() {
  return (
    <Suspense>
      <TimeView />
    </Suspense>
  )
}

const TABS = ["overview", "log", "week", "reports"] as const
type Tab = (typeof TABS)[number]

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
  const tz = ws.current?.workspace.timezone ?? "UTC"
  const kind: RangeKind = params.get("range") === "month" ? "month" : "week"
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview"
  const source: SourceFilter = params.get("source") === "human" ? "human" : params.get("source") === "agent" ? "agent" : "all"
  const user = viewingOther ? userParam : null

  const clock0 = useNow(1000, true)
  const today = dayIn(clock0, tz)
  const ref = params.get("ref") ?? params.get("week") ?? today
  const range = useRangeData(canTrack ? ws.id : "", kind, ref, user)
  const thisWeek = useRangeData(canTrack ? ws.id : "", "week", null, user)
  const refresh = useRefreshTime()
  const { start, stop: stopMine, busy } = useTimerActions()
  const [editing, setEditing] = useState<{ entry: TimeEntry | null; day: string } | null>(null)

  if (ws.current && !canTrack) return (
      <Page>
        <p className="text-sm text-muted-foreground">{t("time.noPermission")}</p>
      </Page>
    )

  function setQuery(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    q.delete("week")
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    const s = q.toString()
    router.replace(`${pathname}${s ? `?${s}` : ""}`)
  }

  const data = range.data
  const sheet = thisWeek.data
  const now = clock0
  const current = data?.current
  const inCurrent = !!current && today >= current.from && today <= current.to
  const parts = data && current ? partsOf(data, current, source) : []
  const cur = statsOf(parts)
  const prev = data ? statsOf(partsOf(data, data.previous, source)) : statsOf([])
  const hasAgent = !!data && (partsOf(data, data.current, "agent").length > 0 || partsOf(data, data.previous, "agent").length > 0)

  // Today's focus is about today whatever period is on screen, so it reads the current week.
  const todayParts = sheet ? partsOf(sheet, { from: today, to: today }, "all") : []
  const drift = sheet?.running ? Math.max(0, Math.floor((now - Date.parse(sheet.now)) / 1000)) : 0
  const todaySeconds = todayParts.reduce((a, p) => a + p.slice.seconds, 0) + (sheet?.running && todayParts.some((p) => p.entry.id === sheet.running?.id) ? drift : 0)
  const todayEntries = new Set(todayParts.map((p) => p.entry.id)).size

  const mayEdit = (e: TimeEntry) => !e.locked && (e.user_id === myId || ws.can("time:manage"))

  const reload = () => {
    void range.mutate()
    void thisWeek.mutate()
    void refresh(ws.id)
  }

  async function remove(e: TimeEntry) {
    try {
      await timeApi.remove(ws.id, e.id)
      toast.success(t("time.deleted"))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
    reload()
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
    reload()
  }

  async function resume(e: TimeEntry) {
    const target = e.task_id ? { task: e.task_id } : e.project_id ? { project: e.project_id } : {}
    await start({ ...target, description: e.description || undefined, billable: e.billable })
    reload()
  }

  return (
    <Page wide>
      <PageHeader
        backHref={viewingOther ? `/${locale}/w/${ws.slug}/time` : undefined}
        labels={{ back: t("time.backToMine") }}
        title={title}
        description={t(viewingOther ? "time.hintOf" : "time.hint", { tz })}
        actions={
          <RangeNav
            kind={kind}
            period={current}
            isCurrent={inCurrent}
            onKind={(k) => setQuery({ range: k === "month" ? "month" : null, ref: null })}
            onShift={(d) => setQuery({ ref: shiftRef(kind, ref, d) })}
            onToday={() => setQuery({ ref: null })}
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setQuery({ tab: v === "overview" ? null : String(v) })}>
          <TabsList data-time-tabs>
            {TABS.map((k) => (
              <TabsTab key={k} value={k} data-tab={k}>
                {t(`time.tab.${k}`)}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        {hasAgent || source !== "all" ? (
          <Select value={source} onValueChange={(v) => setQuery({ source: v === "all" ? null : String(v) })}>
            <SelectTrigger className="w-44" aria-label={t("time.ov.sourceFilter")} data-source-filter>
              <SelectValue>{t(`time.ov.source.${source}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["all", "human", "agent"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`time.ov.source.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {range.error ? (
        <ErrorState error={range.error} />
      ) : !data || !current ? (
        <LoadingRows rows={4} />
      ) : tab === "overview" ? (
        <TimeOverview
          kind={kind}
          period={current}
          cur={cur}
          prev={prev}
          parts={parts}
          tz={tz}
          now={now}
          today={today}
          todaySeconds={todaySeconds}
          todayEntries={todayEntries}
          running={sheet?.running ?? null}
          canTrack={canTrack && !viewingOther}
          busy={busy}
          onResume={resume}
          onStop={stop}
          onOpenLog={() => setQuery({ tab: "log" })}
        />
      ) : tab === "log" ? (
        <LogList
          parts={parts}
          tz={tz}
          now={now}
          today={today}
          mayEdit={mayEdit}
          busy={busy}
          onAdd={(day) => setEditing({ entry: null, day })}
          onEdit={(entry) => setEditing({ entry, day: dayIn(entry.started_at, tz) })}
          onRemove={remove}
          onStop={stop}
        />
      ) : tab === "week" ? (
        <WeekGrid parts={parts} period={current} weekStart={data.week_start} running={data.running} fetchedAt={data.now} now={now} tz={tz} />
      ) : (
        <ReportsTab period={current} userId={user} />
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.entry ? t("time.editTitle") : t("time.add")}</DialogTitle>
            <DialogDescription>{editing ? dayLabel(editing.day, locale, "long") : ""}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <EntryForm
              entry={editing.entry ?? undefined}
              day={editing.day}
              tz={tz}
              user={user}
              onDone={() => {
                setEditing(null)
                reload()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  )
}
