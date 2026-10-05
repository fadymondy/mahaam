"use client"

import Link from "next/link"
import { CalendarRangeIcon, ClockIcon, FolderKanbanIcon, UsersIcon } from "lucide-react"

import { Ltr } from "@/components/copy-field"
import { Panel, StatTile } from "@/components/home/panels"
import { Meter, PersonBadge, PortalEmpty, WeeksChart } from "@/components/portal/portal-bits"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { hours, usePortalTimeAll } from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"

/*
The team's time on the customer's projects (MH-1167, GET /api/w/portal/time): totals, the last 12
weeks, hours per project against its hours budget, and hours per person on projects that share
their team. Never a time entry, a rate or money.
*/
export default function PortalTimePage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("portal.nav.time")} · ${ws.summary.name}`)
  const time = usePortalTimeAll(ws.id)
  const base = `/${locale}/w/${ws.slug}/portal/projects`

  const d = time.data
  const budget = d?.projects.reduce((n, p) => n + (p.budget_minutes ?? 0), 0) ?? 0
  const maxPerson = Math.max(1, ...(d?.people ?? []).map((p) => p.minutes))

  return (
    <>
      <SectionHeader title={t("portal.nav.time")} description={t("portal.timeAll.hint")} />
      <div className="flex flex-col gap-6 px-6 pb-6" data-portal-time>
        {time.error ? (
          <ErrorState error={time.error} />
        ) : !d ? (
          <LoadingRows rows={6} />
        ) : d.projects.length === 0 ? (
          <PortalEmpty icon={<ClockIcon />} title={t("portal.noProjects")} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile icon={<ClockIcon />} label={t("portal.time.tracked")} value={<Ltr>{t("portal.hoursShort", { h: hours(d.total_minutes) })}</Ltr>} sub={t("portal.timeAll.allTime")} />
              <StatTile icon={<CalendarRangeIcon />} label={t("portal.home.monthHours")} value={<Ltr>{t("portal.hoursShort", { h: hours(d.month_minutes) })}</Ltr>} sub={t("portal.home.monthSub")} />
              <StatTile
                icon={<FolderKanbanIcon />}
                label={t("portal.time.budget")}
                value={<Ltr>{budget > 0 ? t("portal.hoursShort", { h: hours(budget) }) : "—"}</Ltr>}
                sub={budget > 0 ? t("portal.timeAll.budgetLeft", { h: hours(Math.max(0, budget - d.total_minutes)) }) : t("portal.timeAll.noBudget")}
              />
            </div>

            <Panel title={t("portal.hoursByWeek")}>
              <WeeksChart weeks={d.weeks} />
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title={t("portal.timeAll.byProject")} data-panel="by-project">
                <ul className="space-y-4">
                  {d.projects.map((p) => {
                    const b = p.budget_minutes ?? 0
                    return (
                      <li key={p.id} className="space-y-1.5" data-time-project={p.id}>
                        <div className="flex items-center gap-2 text-sm">
                          <ColorDot color={p.color} className="shrink-0" />
                          <Link href={`${base}/${p.id}?tab=time`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                            {p.name}
                          </Link>
                          <span className="text-caption tabular-nums text-muted-foreground" dir="ltr">
                            {b > 0 ? t("portal.hoursOfBudget", { used: hours(p.used_minutes), budget: hours(b) }) : t("portal.hoursShort", { h: hours(p.used_minutes) })}
                          </span>
                        </div>
                        {b > 0 ? <Meter value={(p.used_minutes / b) * 100} warn={p.used_minutes > b} label={p.name} /> : null}
                        <p className="text-caption text-muted-foreground">{t("portal.timeAll.thisMonth", { h: hours(p.month_minutes) })}</p>
                      </li>
                    )
                  })}
                </ul>
              </Panel>

              <Panel title={t("portal.timeAll.byPerson")} data-panel="by-person">
                {d.people.length === 0 ? (
                  <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
                    <UsersIcon className="me-2 size-4" />
                    {t("portal.timeAll.noPeople")}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {d.people.map((p, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <PersonBadge name={p.name} initials={p.initials} size="sm" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{p.name}</span>
                            <span className="text-caption tabular-nums text-muted-foreground" dir="ltr">
                              {t("portal.hoursShort", { h: hours(p.minutes) })}
                            </span>
                          </div>
                          <Meter value={(p.minutes / maxPerson) * 100} label={p.name} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </>
  )
}
