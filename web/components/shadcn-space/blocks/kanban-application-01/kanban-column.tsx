"use client"
// Adapted from @shadcnspace/kanban-application-01: a status column with its tasks and a
// quick-add input (Enter adds, Escape cancels) — on the grid (hairlines, no rounded cards).
import { useState } from "react"
import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { PlusIcon } from "lucide-react"

import { Button, Input } from "@fadymondy/nasaq/web"


import TaskCard from "@/components/shadcn-space/blocks/kanban-application-01/task-card"
import type { Column } from "@/components/shadcn-space/blocks/kanban-application-01"
import { Ltr } from "@/components/copy-field"
import { ColorDot } from "@/components/work/palette"
import type { Directory } from "@/components/work/people"
import { useTranslations } from "@/lib/i18n"
import type { Label } from "@/lib/work"

type Props = {
  column: Column
  canWrite: boolean
  dir: Directory
  labels: Label[]
  onOpen: (key: string) => void
  onAddTask: (statusId: string, title: string) => Promise<void>
}

export default function KanbanColumn({ column, canWrite, dir, labels, onOpen, onAddTask }: Props) {
  const { t } = useTranslations()
  const { setNodeRef, isOver } = useDroppable({ id: column.status.id })
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const commit = async () => {
    const title = value.trim()
    if (!title) {
      setAdding(false)
      return
    }
    setBusy(true)
    await onAddTask(column.status.id, title)
    setBusy(false)
    setValue("")
  }

  return (
    <section
      className="flex min-w-64 flex-1 basis-0 flex-col border border-line bg-grid-soft data-[over=true]:border-grid-action"
      data-over={isOver}
      data-status-id={column.status.id}
      data-category={column.status.category}
      aria-label={column.status.name}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ColorDot color={column.status.color} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-grid-fg">{column.status.name}</h2>
        <span className="text-xs text-grid-muted">
          <Ltr>{column.tasks.length}</Ltr>
        </span>
        {canWrite ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("board.addTo", { status: column.status.name })} onClick={() => setAdding(true)}>
            <PlusIcon />
          </Button>
        ) : null}
      </header>

      <div ref={setNodeRef} className="flex min-h-24 flex-col gap-2 p-2">
        <SortableContext items={column.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <TaskCard key={task.id} task={task} dir={dir} labels={labels} draggable={canWrite} onOpen={() => onOpen(task.key)} />
          ))}
        </SortableContext>
        {column.tasks.length === 0 && !adding ? <p className="px-1 py-4 text-center text-xs text-grid-muted">{t("board.emptyColumn")}</p> : null}

        {adding ? (
          <Input
            autoFocus
            disabled={busy}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit()
              if (e.key === "Escape") {
                setValue("")
                setAdding(false)
              }
            }}
            onBlur={() => void commit()}
            placeholder={t("board.newTaskPlaceholder")}
            aria-label={t("board.newTaskPlaceholder")}
            className="bg-grid-card text-sm"
          />
        ) : null}
      </div>
    </section>
  )
}
