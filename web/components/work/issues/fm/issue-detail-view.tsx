"use client"

import { TaskDetail } from "@/components/work/task-detail"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useDocumentTitle } from "@/lib/title"
import { useTranslations } from "@/lib/i18n"
import { useTask } from "@/lib/work"

/** The full-page task / issue detail (an issue and its board card are one item). */
export function IssueDetailView({ issueKey, back }: { issueKey: string; projectId?: string; back: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const task = useTask(ws.id, issueKey)
  useDocumentTitle(`${task.data ? `${task.data.key} · ${task.data.title}` : t("issues.title")} · ${ws.summary.name}`)
  return <TaskDetail taskKey={issueKey} layout="page" back={back} />
}
