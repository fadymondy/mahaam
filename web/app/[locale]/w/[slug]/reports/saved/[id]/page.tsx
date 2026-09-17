"use client"

// Permalink for a saved report view: /reports/saved/{id} loads the view and forwards to its tab
// with its filters, so a saved view has a stable shareable URL of its own.
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { NotFoundState } from "@/components/not-found-state"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { filterQuery, useSavedReport, type ReportKind } from "@/lib/reports"
import { useDocumentTitle } from "@/lib/title"

const TAB: Record<ReportKind, string> = { time: "", budget: "/budgets", profitability: "/profitability" }

export default function SavedReportPermalinkPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const saved = useSavedReport(ws.id, id, ws.can("reports:read"))
  const base = `/${locale}/w/${ws.slug}/reports`
  useDocumentTitle(`${saved.data?.name ?? t("reports.title")} · ${ws.summary.name}`)

  useEffect(() => {
    const v = saved.data
    if (!v) return
    const q = v.kind === "budget" ? "" : filterQuery({ group_by: v.kind === "time" ? "project" : undefined, ...v.filters })
    router.replace(`${base}${TAB[v.kind]}${q ? `?${q}&` : "?"}view=${encodeURIComponent(v.id)}`)
  }, [saved.data, base, router])

  if (saved.error) {
    return saved.error instanceof ApiError && saved.error.status === 404 ? (
      <NotFoundState title={t("saved.notFound")} body={t("saved.notFoundBody")} backHref={base} backLabel={t("reports.title")} />
    ) : (
      <ErrorState error={saved.error} />
    )
  }
  return <LoadingRows rows={4} />
}
