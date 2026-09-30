"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"


import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { NotFoundState } from "@/components/not-found-state"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe, useMembers } from "@/lib/queries"
import { hm, useRates, useTimesheet } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"
import { useTeams } from "@/lib/work"
import { KpiDashboard } from "@/components/kpi/kpi-dashboard"

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const members = useMembers(ws.id)
  const teams = useTeams(ws.id, ws.can("teams:read"))
  const canRates = ws.can("rates:read")
  const rates = useRates(ws.id, canRates)
  const isSelf = me.data ? String(me.data.id) === id : false
  const canTime = ws.can("time:manage") || isSelf
  const sheet = useTimesheet(ws.id, null, canTime ? id : null)
  const back = `/${locale}/w/${ws.slug}/members`

  const member = (members.data?.members ?? []).find((m) => m.user_id === id)
  useDocumentTitle(`${member?.email ?? t("nav.members")} · ${ws.summary.name}`)

  if (members.error) return <ErrorState error={members.error} />
  if (members.isLoading) return <LoadingRows rows={5} />
  if (!member) {
    return <NotFoundState title={t("memberDetail.notFound")} body={t("memberDetail.notFoundBody")} backHref={back} backLabel={t("nav.members")} />
  }

  const memberTeams = (teams.data?.teams ?? []).filter((tm) => tm.member_ids.includes(id))
  const rateEntry = rates.data?.members.find((m) => m.user_id === id)
  const cur = rates.data?.currency || ws.current?.workspace.currency || "USD"
  const rateFor = (minor: number | null) => (minor != null ? money(minor, cur, locale) : t("memberDetail.rateDefault"))

  return (
    <>
      <div className="px-6 pt-5">
        <Link href={back} className="inline-flex items-center gap-1 text-meta text-grid-muted hover:text-grid-fg">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("nav.members")}
        </Link>
      </div>
      <SectionHeader
        micro={ws.summary.name}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <PersonAvatar id={id} dir={dir} size="md" />
            <Ltr>{member.email}</Ltr>
            <Badge variant="outline">{t(`role.${member.role}`)}</Badge>
          </span>
        }
      />

      <div className="grid gap-px border-y border-line bg-grid-line lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* main */}
        <div className="min-w-0 bg-grid-bg">
          <dl className="grid grid-cols-2 gap-px border-b border-line bg-grid-line text-sm">
            <div className="bg-grid-bg px-6 py-3">
              <dt className="grid-micro mb-1">{t("members.role")}</dt>
              <dd className="text-grid-fg">{t(`role.${member.role}`)}</dd>
            </div>
            <div className="bg-grid-bg px-6 py-3">
              <dt className="grid-micro mb-1">{t("members.joined")}</dt>
              <dd className="text-grid-fg">{member.joined_at ? <Ltr>{formatDay(member.joined_at, locale)}</Ltr> : "—"}</dd>
            </div>
          </dl>

          <h2 className="px-6 pt-6 pb-3 text-base font-medium">{t("memberDetail.teams")}</h2>
          {teams.error ? (
            <ErrorState error={teams.error} />
          ) : memberTeams.length === 0 ? (
            <EmptyState title={t("memberDetail.noTeams")} />
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {memberTeams.map((tm) => (
                <li key={tm.id}>
                  <Link href={`/${locale}/w/${ws.slug}/teams/${tm.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-grid-soft">
                    <ColorDot color={tm.color} className="size-3" />
                    <span className="min-w-0 flex-1 truncate font-medium text-grid-fg">{tm.name}</span>
                    <span className="text-meta text-grid-muted">{t("teams.memberCount", { n: tm.member_ids.length })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2 className="px-6 pt-6 pb-3 text-base font-medium">{t("memberDetail.recentTime")}</h2>
          {!canTime ? (
            <p className="px-6 pb-6 text-sm text-grid-muted">{t("memberDetail.timeNoPermission")}</p>
          ) : sheet.error ? (
            <ErrorState error={sheet.error} />
          ) : !sheet.data ? (
            <LoadingRows rows={2} />
          ) : sheet.data.rows.length === 0 ? (
            <EmptyState title={t("memberDetail.noTime")} />
          ) : (
            <div className="border-y border-line">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6">{t("nav.projects")}</TableHead>
                    <TableHead className="pe-6 text-end">{t("memberDetail.tracked")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheet.data.rows.map((row, i) => (
                    <TableRow key={`${row.project_id}-${row.task_id}-${i}`}>
                      <TableCell className="ps-6">
                        <span className="flex min-w-0 items-center gap-2">
                          {row.project_color ? <ColorDot color={row.project_color} /> : null}
                          <span className="min-w-0 truncate text-grid-fg">
                            {row.project_name ?? t("project.noClient")}
                            {row.task_title ? <span className="text-grid-muted"> · {row.task_title}</span> : null}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="pe-6 text-end tabular-nums">
                        <Ltr mono>{hm(row.total_s, "0:00")}</Ltr>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* side rail: rates (managers only) */}
        <aside className="min-w-0 bg-grid-bg">
          <h2 className="px-6 pt-5 pb-3 text-base font-medium">{t("memberDetail.rates")}</h2>
          {!canRates ? (
            <p className="px-6 pb-6 text-sm text-grid-muted">{t("memberDetail.ratesNoPermission")}</p>
          ) : rates.error ? (
            <ErrorState error={rates.error} />
          ) : !rates.data ? (
            <LoadingRows rows={2} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-px border-y border-line bg-grid-line text-sm">
                <div className="bg-grid-bg px-6 py-3">
                  <dt className="grid-micro mb-1">{t("memberDetail.billRate")}</dt>
                  <dd className="text-grid-fg"><Ltr>{rateFor(rateEntry?.current?.bill_rate_minor ?? null)}</Ltr></dd>
                </div>
                <div className="bg-grid-bg px-6 py-3">
                  <dt className="grid-micro mb-1">{t("memberDetail.costRate")}</dt>
                  <dd className="text-grid-fg"><Ltr>{rateFor(rateEntry?.current?.cost_rate_minor ?? null)}</Ltr></dd>
                </div>
              </dl>
              <h3 className="px-6 pt-5 pb-2 text-sm font-medium">{t("memberDetail.rateHistory")}</h3>
              {!rateEntry || rateEntry.history.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-grid-muted">{t("memberDetail.noRateHistory")}</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line text-sm">
                  {rateEntry.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-2.5">
                      <span className="text-grid-muted"><Ltr>{formatDay(h.effective_from, locale)}</Ltr></span>
                      <span className="tabular-nums text-grid-fg">
                        <Ltr>{money(h.bill_rate_minor, h.currency, locale)}</Ltr>
                        <span className="text-grid-muted"> · {money(h.cost_rate_minor, h.currency, locale)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>

      {/* the employee KPI: your own, or anyone's as a manager (clients have none) */}
      {member.role !== "client" && (isSelf || ws.can("kpi:all")) ? (
        <div className="pt-6 pb-8">
          <KpiDashboard userId={id} isSelf={isSelf} />
        </div>
      ) : null}
    </>
  )
}
