"use client"

// The task side-over (?task=MH-12 on any project tab): the same TaskDetail as the full page,
// in its single-column "sheet" layout. Every field saves on its own; the board and lists
// revalidate through onChanged.
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@fadymondy/nasaq/web"

import { TaskDetail } from "@/components/work/task-detail"
import { useTranslations } from "@/lib/i18n"
import type { Status } from "@/lib/work"

export function TaskSheet({
  taskKey,
  onClose,
  onOpen,
  onChanged,
}: {
  taskKey: string | null
  /** Kept for the caller's signature; the detail reads the project's columns itself. */
  statuses?: Status[]
  onClose: () => void
  onOpen: (key: string) => void
  onChanged: () => void
}) {
  const { t } = useTranslations()
  return (
    <Sheet open={!!taskKey} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="end"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl!"
        data-task-sheet={taskKey ?? ""}
      >
        <SheetTitle className="sr-only">{taskKey ?? t("task.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("td.info")}</SheetDescription>
        {taskKey ? <TaskDetail taskKey={taskKey} layout="sheet" onOpen={onOpen} onChanged={onChanged} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  )
}
