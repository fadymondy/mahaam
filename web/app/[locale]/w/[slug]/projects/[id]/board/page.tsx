"use client"

import KanbanBoard from "@/components/shadcn-space/blocks/kanban-application-01"
import { ErrorState } from "@/components/states"
import { Skeleton } from "@/components/ui/skeleton"
import { useDirectory } from "@/components/work/people"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { useBoard, useLabels } from "@/lib/work"

export default function BoardPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { project, openTask } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.board")} · ${project.name}`)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const board = useBoard(ws.id, project.id)
  const labels = useLabels(ws.id)

  if (board.error) return <ErrorState error={board.error} />
  if (!board.data)
    return (
      <div className="flex gap-3 p-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 w-72" />
        ))}
      </div>
    )
  return (
    <>
      {!project.can_write && !project.archived_at ? <p className="border-b border-line px-6 py-2 text-sm text-grid-muted">{t("board.readOnly")}</p> : null}
      <KanbanBoard
        board={board.data}
        workspaceId={ws.id}
        canWrite={project.can_write}
        dir={dir}
        labels={labels.data?.labels ?? []}
        onOpen={openTask}
        onChanged={() => void board.mutate()}
      />
    </>
  )
}
