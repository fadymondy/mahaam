"use client"

// Issues live inside their project: an issue IS its project's card (same key). Old links —
// notifications, e-mails, MCP answers, bookmarks — land here and continue to the issue inside its project.
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { ApiError } from "@/lib/api"
import { NotFoundState } from "@/components/not-found-state"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useIssue } from "@/lib/work"

export default function IssueRedirectPage() {
  const { key } = useParams<{ key: string }>()
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const issue = useIssue(ws.id, key)
  const pid = issue.data?.project_id

  useEffect(() => {
    if (pid) router.replace(`/${locale}/w/${ws.slug}/projects/${pid}/issues/${encodeURIComponent(key)}`)
  }, [pid, key, locale, ws.slug, router])

  if (issue.error) {
    return issue.error instanceof ApiError && issue.error.status === 404 ? (
      <NotFoundState title={t("issues.notFound")} body={t("issues.notFoundBody")} backHref={`/${locale}/w/${ws.slug}/projects`} backLabel={t("nav.projects")} />
    ) : (
      <ErrorState error={issue.error} />
    )
  }
  return <LoadingRows rows={5} />
}
