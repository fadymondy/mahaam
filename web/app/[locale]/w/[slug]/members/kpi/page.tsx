"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { RangePicker } from "@/components/kpi/kpi-dashboard"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { compact, defaultRange, useTeamKPI } from "@/lib/kpi"
import { hm } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"

// The team KPI table (manager+): one headline row per employee; each row opens their dashboard.
export default function TeamKpiPage() {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const allowed = ws.can("kpi:all")
  const [range, setRange] = useState(defaultRange)
  const team = useTeamKPI(ws.id, range.from, range.to, allowed)
  const base = `/${locale}/w/${ws.slug}/members`
  useDocumentTitle(`${t("kpi.teamTitle")} · ${ws.summary.name}`)

  const rows = team.data?.rows ?? []
  const num = "text-end tabular-nums"
  return (
    <>
      <div className="px-6 pt-5">
        <Link href={base} className="inline-flex items-center gap-1 text-meta text-grid-muted hover:text-grid-fg">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("nav.members")}
        </Link>
      </div>
      <SectionHeader
        micro={ws.summary.name}
        title={t("kpi.teamTitle")}
        description={t("kpi.teamHint")}
        action={allowed ? <RangePicker from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /> : null}
      />
      {!allowed ? (
        <p className="px-6 py-6 text-sm text-grid-muted">{t("kpi.teamNoPermission")}</p>
      ) : team.error ? (
        <ErrorState error={team.error} />
      ) : !team.data ? (
        <LoadingRows rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("kpi.teamEmpty")} />
      ) : (
        <div className="overflow-x-auto border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("kpi.member")}</TableHead>
                <TableHead className={num}>{t("kpi.hours")}</TableHead>
                <TableHead className={num}>{t("kpi.billable")}</TableHead>
                <TableHead className={num}>{t("kpi.daysTracked")}</TableHead>
                <TableHead className={num}>{t("kpi.tasksDone")}</TableHead>
                <TableHead className={num}>{t("kpi.overdue")}</TableHead>
                <TableHead className={num}>{t("kpi.issuesFinished")}</TableHead>
                <TableHead className={num}>{t("kpi.aiTokens")}</TableHead>
                {team.data.finance ? <TableHead className={num}>{t("kpi.aiCost")}</TableHead> : null}
                <TableHead className={num}>{t("kpi.commits")}</TableHead>
                <TableHead className={num}>{t("kpi.prsMerged")}</TableHead>
                <TableHead className={num}>{t("kpi.mcp")}</TableHead>
                <TableHead className={`${num} pe-6`}>{t("kpi.rating")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.member.user_id}>
                  <TableCell className="ps-6">
                    <Link href={`${base}/${r.member.user_id}`} className="font-medium text-grid-fg hover:underline">
                      <Ltr>{r.member.email}</Ltr>
                    </Link>
                    <span className="ms-2 text-meta text-grid-muted">{t(`role.${r.member.role}`)}</span>
                  </TableCell>
                  <TableCell className={num}>
                    <Ltr mono>{hm(r.tracked_s, "0:00")}</Ltr>
                  </TableCell>
                  <TableCell className={num}>
                    <Ltr mono>{hm(r.billable_s, "0:00")}</Ltr>
                  </TableCell>
                  <TableCell className={num}>{r.days_tracked}</TableCell>
                  <TableCell className={num}>{r.tasks_completed}</TableCell>
                  <TableCell className={num}>{r.tasks_overdue}</TableCell>
                  <TableCell className={num}>{r.issues_finished}</TableCell>
                  <TableCell className={num}>
                    <Ltr>{compact(r.ai_tokens)}</Ltr>
                  </TableCell>
                  {team.data?.finance ? (
                    <TableCell className={num}>
                      <Ltr>{money(r.ai_cost_minor ?? 0, team.data.currency, locale)}</Ltr>
                    </TableCell>
                  ) : null}
                  <TableCell className={num} title={r.github_login ? `@${r.github_login}` : t("kpi.notConnected")}>
                    {r.github_login ? r.commits : "—"}
                  </TableCell>
                  <TableCell className={num}>{r.github_login ? r.prs_merged : "—"}</TableCell>
                  <TableCell className={num}>{r.mcp_actions}</TableCell>
                  <TableCell className={`${num} pe-6`}>{r.avg_rating != null ? r.avg_rating.toFixed(1) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
