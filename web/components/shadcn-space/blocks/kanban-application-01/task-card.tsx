"use client"
// Adapted from @shadcnspace/kanban-application-01: a sortable task card. A short press opens the
// task (the pointer sensor only starts a drag after 6px), Enter/Space picks it up by keyboard.
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { CalendarIcon, CheckSquareIcon, GitBranchIcon, MessageSquareIcon, PaperclipIcon } from "lucide-react"

import { Ltr } from "@/components/copy-field"
import { LabelChips, PriorityIcon } from "@/components/work/fields"
import { AvatarStack, type Directory } from "@/components/work/people"
import { formatDay, isOverdue } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Label, Task } from "@/lib/work"

export function TaskCardBody({ task, dir, labels }: { task: Task; dir: Directory; labels: Label[] }) {
  const { t, locale } = useTranslations()
  const overdue = isOverdue(task.due_at, task.completed_at)
  return (
    <>
      <div className="flex items-center gap-2 text-xs text-grid-muted">
        <Ltr mono>{task.key}</Ltr>
        {task.priority !== "none" ? <PriorityIcon priority={task.priority} /> : null}
        {task.parent_id ? <GitBranchIcon className="size-3" aria-label={t("task.subtask")} /> : null}
      </div>
      <p className={cn("mt-1 text-sm font-medium break-words text-grid-fg", task.completed_at && "text-grid-muted line-through")}>{task.title}</p>
      {task.label_ids.length ? (
        <div className="mt-2">
          <LabelChips ids={task.label_ids} labels={labels} />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-grid-muted">
        {task.due_at ? (
          <span className={cn("flex items-center gap-1", overdue && "text-grid-danger-text")}>
            <CalendarIcon className="size-3" />
            <Ltr>{formatDay(task.due_at, locale, "short")}</Ltr>
          </span>
        ) : null}
        {task.checklist_total ? (
          <span className="flex items-center gap-1" aria-label={t("task.checklistProgress", { done: task.checklist_done, total: task.checklist_total })}>
            <CheckSquareIcon className="size-3" />
            <Ltr>
              {task.checklist_done}/{task.checklist_total}
            </Ltr>
          </span>
        ) : null}
        {task.subtask_count ? (
          <span className="flex items-center gap-1" aria-label={t("task.subtasks")}>
            <GitBranchIcon className="size-3" />
            <Ltr>
              {task.subtask_done}/{task.subtask_count}
            </Ltr>
          </span>
        ) : null}
        {task.comment_count ? (
          <span className="flex items-center gap-1" aria-label={t("task.comments")}>
            <MessageSquareIcon className="size-3" />
            <Ltr>{task.comment_count}</Ltr>
          </span>
        ) : null}
        {task.attachment_count ? (
          <span className="flex items-center gap-1" aria-label={t("task.attachments")}>
            <PaperclipIcon className="size-3" />
            <Ltr>{task.attachment_count}</Ltr>
          </span>
        ) : null}
        <span className="ms-auto">
          <AvatarStack ids={task.assignee_ids} dir={dir} max={3} />
        </span>
      </div>
    </>
  )
}

export default function TaskCard({
  task,
  dir,
  labels,
  draggable,
  onOpen,
}: {
  task: Task
  dir: Directory
  labels: Label[]
  draggable: boolean
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !draggable })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      data-task-key={task.key}
      onClick={onOpen}
      onKeyDown={(e) => {
        // dnd-kit's keyboard sensor owns Space/Enter while dragging; "o" opens without picking up.
        if (e.key.toLowerCase() === "o") onOpen()
        listeners?.onKeyDown?.(e)
      }}
      className={cn(
        "w-full border border-line bg-grid-card p-3 text-start transition-colors outline-none hover:border-grid-muted focus-visible:ring-2 focus-visible:ring-grid-action",
        draggable && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <TaskCardBody task={task} dir={dir} labels={labels} />
    </div>
  )
}
