"use client"
// Adapted from @shadcnspace/kanban-application-01 (dnd-kit): columns are a project's statuses,
// cards are its tasks, and a drop persists through POST /api/w/tasks/{key}/move with the task's
// final column and 0-based index. The server gives it a fractional position between its new
// neighbours, so the order survives a reload. A failed move rolls the board back.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { toast } from "@fadymondy/nasaq/web"

import KanbanColumn from "@/components/shadcn-space/blocks/kanban-application-01/kanban-column"
import { TaskCardBody } from "@/components/shadcn-space/blocks/kanban-application-01/task-card"
import type { Directory } from "@/components/work/people"
import { useTranslations } from "@/lib/i18n"
import { errorText, w, type Board, type Label, type Status, type Task } from "@/lib/work"

export type Column = { status: Status; tasks: Task[] }

function toColumns(board: Board): Column[] {
  return board.statuses.map((status) => ({
    status,
    tasks: board.tasks.filter((t) => t.status_id === status.id).sort((a, b) => a.position - b.position),
  }))
}

export default function KanbanBoard({
  board,
  workspaceId,
  canWrite,
  dir,
  labels,
  onOpen,
  onChanged,
}: {
  board: Board
  workspaceId: string
  canWrite: boolean
  dir: Directory
  labels: Label[]
  onOpen: (key: string) => void
  /** Revalidate the server copy (after a create or a failed move). */
  onChanged: () => void
}) {
  const { t } = useTranslations()
  const [columns, setColumns] = useState<Column[]>(() => toColumns(board))
  const [active, setActive] = useState<Task | null>(null)
  const dragging = useRef(false)

  // Follow the server while nothing is being dragged.
  useEffect(() => {
    if (!dragging.current) setColumns(toColumns(board))
  }, [board])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findColumn = (id: string, cols = columns): Column | null =>
    cols.find((c) => c.status.id === id) ?? cols.find((c) => c.tasks.some((t) => t.id === id)) ?? null

  const handleDragStart = (e: DragStartEvent) => {
    dragging.current = true
    setActive(findColumn(String(e.active.id))?.tasks.find((t) => t.id === e.active.id) ?? null)
  }

  // Cross-column: move the card into the column it is over (the block's own logic).
  const handleDragOver = (e: DragOverEvent) => {
    const { active: a, over } = e
    if (!over || a.id === over.id) return
    setColumns((prev) => {
      const from = findColumn(String(a.id), prev)
      const to = findColumn(String(over.id), prev)
      if (!from || !to || from.status.id === to.status.id) return prev
      const moving = from.tasks.find((t) => t.id === a.id)
      if (!moving) return prev
      const overIndex = to.tasks.findIndex((t) => t.id === over.id)
      const at = overIndex >= 0 ? overIndex : to.tasks.length
      return prev.map((c) => {
        if (c.status.id === from.status.id) return { ...c, tasks: c.tasks.filter((t) => t.id !== a.id) }
        if (c.status.id === to.status.id) {
          const tasks = [...c.tasks]
          tasks.splice(at, 0, { ...moving, status_id: to.status.id })
          return { ...c, tasks }
        }
        return c
      })
    })
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active: a, over } = e
    setActive(null)
    const original = board.tasks.find((t) => t.id === a.id)
    let next = columns
    if (over) {
      const col = findColumn(String(a.id))
      const overCol = findColumn(String(over.id))
      // Same-column reorder (the block's arrayMove).
      if (col && overCol && col.status.id === overCol.status.id) {
        const from = col.tasks.findIndex((t) => t.id === a.id)
        const to = col.tasks.findIndex((t) => t.id === over.id)
        if (from >= 0 && to >= 0 && from !== to) {
          next = columns.map((c) => (c.status.id === col.status.id ? { ...c, tasks: arrayMove(c.tasks, from, to) } : c))
          setColumns(next)
        }
      }
    }
    dragging.current = false
    const col = findColumn(String(a.id), next)
    if (!col || !original) return
    const index = col.tasks.findIndex((t) => t.id === a.id)
    const before = toColumns(board).find((c) => c.status.id === original.status_id)
    const unchanged = col.status.id === original.status_id && before?.tasks.findIndex((t) => t.id === a.id) === index
    if (unchanged) return
    try {
      await w.post(workspaceId, `/api/w/tasks/${encodeURIComponent(original.key)}/move`, { status: col.status.id, index })
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("board.moveFailed")))
      setColumns(toColumns(board))
      onChanged()
    }
  }

  const handleAdd = async (statusId: string, title: string) => {
    try {
      await w.post(workspaceId, `/api/w/projects/${encodeURIComponent(board.statuses[0]?.project_id ?? "")}/tasks`, { title, status: statusId })
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  const byStatus = useMemo(() => new Map(columns.map((c) => [c.status.id, c])), [columns])

  return (
    <div className="overflow-x-auto" data-board>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={canWrite ? handleDragOver : undefined}
        onDragEnd={canWrite ? handleDragEnd : () => setActive(null)}
        onDragCancel={() => {
          dragging.current = false
          setActive(null)
          setColumns(toColumns(board))
        }}
        accessibility={{
          screenReaderInstructions: { draggable: t("board.dragInstructions") },
        }}
      >
        <div className="flex w-full min-w-max items-start gap-3 p-4 sm:p-6">
          {board.statuses.map((s) => (
            <KanbanColumn
              key={s.id}
              column={byStatus.get(s.id) ?? { status: s, tasks: [] }}
              canWrite={canWrite}
              dir={dir}
              labels={labels}
              onOpen={onOpen}
              onAddTask={handleAdd}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="w-72 rotate-1 border border-border bg-card p-3 shadow-lg">
              <TaskCardBody task={active} dir={dir} labels={labels} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
