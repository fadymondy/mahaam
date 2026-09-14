"use client"

import { ErrorState, LoadingRows } from "@/components/states"
import { useDirectory } from "@/components/work/people"
import { useProjectCtx } from "@/components/work/project-context"
import { TaskList } from "@/components/work/task-list"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { useBoard, useLabels } from "@/lib/work"

export default function ListPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { project, openTask } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.list")} · ${project.name}`)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const board = useBoard(ws.id, project.id)
  const labels = useLabels(ws.id)
  if (board.error) return <ErrorState error={board.error} />
  if (!board.data) return <LoadingRows rows={5} />
  return <TaskList board={board.data} labels={labels.data?.labels ?? []} dir={dir} onOpen={openTask} />
}
