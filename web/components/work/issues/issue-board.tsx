"use client"
// The issues board: one column per status, dnd-kit drag within and between columns (the pattern of
// components/work/kanban). A drop persists through
// POST /api/w/issues/{key}/move — after the card above it, before the card below it, or into an
// empty column by status — and a failed move rolls the board back.
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { FolderIcon, MessageSquareIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { AgentTime, HumanOnlyMark, IssuePriorityMark, IssueTypeIcon } from "@/components/work/issues/issue-bits"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ISSUE_STATUSES, errorText, issuesApi, type Issue, type IssueStatus } from "@/lib/work"

type Column = { status: IssueStatus; issues: Issue[] }

const COL_PREFIX = "col:"

// The pointer-up that ends a drag also clicks the card link; swallow that one click.
let lastDragEnd = 0

function toColumns(issues: Issue[]): Column[] {
  return ISSUE_STATUSES.map((status) => ({
    status,
    issues: issues.filter((i) => i.status === status).sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export function IssueBoard({
  issues,
  workspaceId,
  canWrite,
  projectName,
  hrefFor,
  onChanged,
}: {
  issues: Issue[]
  workspaceId: string
  canWrite: boolean
  projectName: (id: string | null) => string | null
  hrefFor: (key: string) => string
  onChanged: () => void
}) {
  const { t } = useTranslations()
  const [columns, setColumns] = useState<Column[]>(() => toColumns(issues))
  const [active, setActive] = useState<Issue | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (!dragging.current) setColumns(toColumns(issues))
  }, [issues])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findColumn = (id: string, cols = columns): Column | null =>
    (id.startsWith(COL_PREFIX) ? cols.find((c) => COL_PREFIX + c.status === id) : cols.find((c) => c.issues.some((i) => i.key === id))) ?? null

  const handleDragStart = (e: DragStartEvent) => {
    dragging.current = true
    setActive(issues.find((i) => i.key === e.active.id) ?? null)
  }

  const handleDragOver = (e: DragOverEvent) => {
    const { active: a, over } = e
    if (!over || a.id === over.id) return
    setColumns((prev) => {
      const from = findColumn(String(a.id), prev)
      const to = findColumn(String(over.id), prev)
      if (!from || !to || from.status === to.status) return prev
      const moving = from.issues.find((i) => i.key === a.id)
      if (!moving) return prev
      const overIndex = to.issues.findIndex((i) => i.key === over.id)
      const at = overIndex >= 0 ? overIndex : to.issues.length
      return prev.map((c) => {
        if (c.status === from.status) return { ...c, issues: c.issues.filter((i) => i.key !== a.id) }
        if (c.status === to.status) {
          const list = [...c.issues]
          list.splice(at, 0, { ...moving, status: to.status })
          return { ...c, issues: list }
        }
        return c
      })
    })
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active: a, over } = e
    setActive(null)
    lastDragEnd = Date.now()
    const key = String(a.id)
    const original = issues.find((i) => i.key === key)
    let next = columns
    if (over) {
      const col = findColumn(key)
      const overCol = findColumn(String(over.id))
      if (col && overCol && col.status === overCol.status) {
        const from = col.issues.findIndex((i) => i.key === key)
        const to = col.issues.findIndex((i) => i.key === over.id)
        if (from >= 0 && to >= 0 && from !== to) {
          next = columns.map((c) => (c.status === col.status ? { ...c, issues: arrayMove(c.issues, from, to) } : c))
          setColumns(next)
        }
      }
    }
    dragging.current = false
    const col = findColumn(key, next)
    if (!col || !original) return
    const index = col.issues.findIndex((i) => i.key === key)
    const before = toColumns(issues).find((c) => c.status === original.status)
    if (col.status === original.status && before?.issues.findIndex((i) => i.key === key) === index) return

    const above = col.issues[index - 1]
    const below = col.issues[index + 1]
    const to = above ? { after: above.key } : below ? { before: below.key } : { status: col.status }
    try {
      await issuesApi.move(workspaceId, key, to)
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("issues.moveFailed")))
      setColumns(toColumns(issues))
      onChanged()
    }
  }

  const byStatus = useMemo(() => new Map(columns.map((c) => [c.status, c])), [columns])

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
          setColumns(toColumns(issues))
        }}
        accessibility={{ screenReaderInstructions: { draggable: t("board.dragInstructions") } }}
      >
        <div className="flex w-full min-w-max items-start gap-3 p-4 sm:p-6">
          {ISSUE_STATUSES.map((s) => (
            <IssueColumn
              key={s}
              column={byStatus.get(s) ?? { status: s, issues: [] }}
              canWrite={canWrite}
              projectName={projectName}
              hrefFor={hrefFor}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="w-64 rotate-1 border border-border bg-card p-3 shadow-lg">
              <IssueCardBody issue={active} projectName={projectName} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function IssueColumn({
  column,
  canWrite,
  projectName,
  hrefFor,
}: {
  column: Column
  canWrite: boolean
  projectName: (id: string | null) => string | null
  hrefFor: (key: string) => string
}) {
  const { t } = useTranslations()
  const { setNodeRef, isOver } = useDroppable({ id: COL_PREFIX + column.status })
  const label = t(`issues.status.${column.status}`)
  return (
    <section
      className="flex w-64 shrink-0 flex-col border border-border bg-muted data-[over=true]:border-nq-action"
      data-over={isOver}
      data-status={column.status}
      aria-label={label}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</h2>
        <span className="text-caption text-muted-foreground tabular-nums">
          <Ltr>{column.issues.length}</Ltr>
        </span>
      </header>
      <div ref={setNodeRef} className="flex min-h-24 flex-col gap-2 p-2">
        <SortableContext items={column.issues.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          {column.issues.map((issue) => (
            <IssueCard key={issue.key} issue={issue} draggable={canWrite} projectName={projectName} href={hrefFor(issue.key)} />
          ))}
        </SortableContext>
        {column.issues.length === 0 ? <p className="px-1 py-4 text-center text-caption text-muted-foreground">{t("issues.emptyColumn")}</p> : null}
      </div>
    </section>
  )
}

export function IssueCardBody({ issue, projectName }: { issue: Issue; projectName: (id: string | null) => string | null }) {
  const { t } = useTranslations()
  const project = projectName(issue.project_id)
  return (
    <>
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <IssueTypeIcon type={issue.issue_type} />
        <Ltr mono>{issue.key}</Ltr>
        <IssuePriorityMark priority={issue.priority} className="ms-auto" />
      </div>
      <p className={cn("mt-1 text-sm font-medium break-words text-foreground", issue.status === "done" && "text-muted-foreground line-through")} dir="auto">
        {issue.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        {project ? (
          <span className="flex min-w-0 items-center gap-1">
            <FolderIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate" dir="auto">{project}</span>
          </span>
        ) : null}
        {issue.human_only ? <HumanOnlyMark /> : null}
        <AgentTime seconds={issue.agent_seconds} />
        {issue.comment_count ? (
          <span className="flex items-center gap-1" aria-label={t("issues.commentCount", { count: issue.comment_count })}>
            <MessageSquareIcon className="size-3" aria-hidden />
            <Ltr>{issue.comment_count}</Ltr>
          </span>
        ) : null}
      </div>
    </>
  )
}

function IssueCard({
  issue,
  draggable,
  projectName,
  href,
}: {
  issue: Issue
  draggable: boolean
  projectName: (id: string | null) => string | null
  href: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.key, disabled: !draggable })
  // A Link as the sortable node: a short press navigates (the pointer sensor only starts a drag after 6px).
  return (
    <Link
      href={href}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      data-issue-key={issue.key}
      draggable={false}
      onClick={(e) => {
        if (Date.now() - lastDragEnd < 300) e.preventDefault()
      }}
      className={cn(
        "block w-full border border-border bg-card p-3 text-start transition-colors outline-none hover:border-nq-line-strong focus-visible:ring-2 focus-visible:ring-nq-action",
        draggable && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <IssueCardBody issue={issue} projectName={projectName} />
    </Link>
  )
}
