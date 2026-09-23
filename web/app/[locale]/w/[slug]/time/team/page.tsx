"use client"

// Team timesheets (time:manage — managers and up): every member's week in the workspace timezone,
// with a live "timer running" marker, opening into that member's week.
import Link from "next/link"
import { Suspense } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { WeekNav } from "@/components/time/week-nav"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { dayIn, hm, useTeamTimesheet, weekdayShort } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

export default function TeamTimePage() {
  return (
    <Suspense>
      <TeamView />
    </Suspense>
  )
}

function TeamView() {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  useDocumentTitle(`${t("team.title")} · ${ws.summary.name}`)
  const manage = ws.can("time:manage")
  const week = params.get("week")
  const team = useTeamTimesheet(ws.id, week, manage)

  if (ws.current && !manage) return <p className="px-6 py-6 text-sm text-grid-muted">{t("team.noPermission")}</p>

  const tt = team.data
  const tz = tt?.timezone ?? ws.current?.workspace.timezone ?? "UTC"
  const today = dayIn(Date.now(), tz)
  const days = tt?.days ?? []
  const open = (user: string) => `/${locale}/w/${ws.slug}/time?user=${encodeURIComponent(user)}${week ? `&week=${week}` : ""}`

  return (
    <>
      <SectionHeader
        micro={ws.summary.name}
        title={t("team.title")}
        description={t("team.hint", { tz })}
        action={<WeekNav days={tt?.days} isCurrent={days.includes(today)} onWeek={(ref) => router.replace(`${pathname}${ref ? `?week=${ref}` : ""}`)} />}
      />
      {team.error ? (
        <ErrorState error={team.error} />
      ) : !tt ? (
        <LoadingRows rows={4} />
      ) : tt.members.length === 0 ? (
        <EmptyState title={t("team.empty")} />
      ) : (
        <div className="border-y border-line" data-team-grid>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("team.member")}</TableHead>
                {days.map((d) => (
                  <TableHead key={d} className={cn("hidden w-[7%] text-end md:table-cell", d === today && "text-grid-fg")}>
                    <span className="block text-xs font-normal text-grid-muted">{weekdayShort(d, locale)}</span>
                    <Ltr>{Number(d.slice(8))}</Ltr>
                  </TableHead>
                ))}
                <TableHead className="text-end">{t("time.total")}</TableHead>
                <TableHead className="hidden text-end sm:table-cell">{t("time.billable")}</TableHead>
                <TableHead className="pe-6 text-end">
                  <span className="sr-only">{t("team.open")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tt.members.map((m) => (
                <TableRow key={m.user_id} data-team-member={m.user_id}>
                  <TableCell className="max-w-0 ps-6">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PersonAvatar id={m.user_id} dir={dir} />
                      <span className="min-w-0">
                        <Ltr className="block truncate text-sm">{dir.name(m.user_id)}</Ltr>
                        <span className="flex items-center gap-2 text-meta text-grid-muted">
                          {t(`role.${m.role}`)}
                          {m.running ? (
                            <Badge variant="outline" className="gap-1.5" data-team-running>
                              <span className="size-1.5 animate-pulse rounded-full bg-grid-action motion-reduce:animate-none" aria-hidden />
                              {t("team.runningNow")}
                            </Badge>
                          ) : null}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  {days.map((d, i) => (
                    <TableCell key={d} className={cn("hidden text-end tabular-nums md:table-cell", d === today && "bg-grid-soft/60")}>
                      <Ltr mono className={m.seconds[i] ? "" : "text-grid-line"}>
                        {hm(m.seconds[i], "·")}
                      </Ltr>
                    </TableCell>
                  ))}
                  <TableCell className="text-end font-medium tabular-nums">
                    <Ltr mono>{hm(m.total_s, "0:00")}</Ltr>
                  </TableCell>
                  <TableCell className="hidden text-end text-grid-muted tabular-nums sm:table-cell">
                    <Ltr mono>{hm(m.billable_s, "0:00")}</Ltr>
                  </TableCell>
                  <TableCell className="pe-6 text-end">
                    <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={open(m.user_id)} />} data-open-member={m.user_id}>
                      {t("team.open")}
                      {isRtl ? <ChevronRightIcon className="rotate-180" /> : <ChevronRightIcon />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="ps-6 font-medium">{t("time.dayTotal")}</TableCell>
                {days.map((d, i) => (
                  <TableCell key={d} className="hidden text-end font-medium tabular-nums md:table-cell">
                    <Ltr mono>{hm(tt.day_totals[i], "0:00")}</Ltr>
                  </TableCell>
                ))}
                <TableCell className="text-end font-semibold tabular-nums">
                  <Ltr mono>{hm(tt.total_s, "0:00")}</Ltr>
                </TableCell>
                <TableCell className="hidden text-end tabular-nums sm:table-cell">
                  <Ltr mono>{hm(tt.billable_s, "0:00")}</Ltr>
                </TableCell>
                <TableCell className="pe-6" />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </>
  )
}
