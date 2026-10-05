"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core"
import { ClockIcon, Loader2Icon, PlusIcon, SearchIcon, SparklesIcon, UserRoundIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from "@fadymondy/nasaq/web"




import { ErrorState } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  errorText,
  issuesApi,
  useIssues,
  useProject,
  w,
  type Status,
  type Issue,
  type IssueStatus,
} from "@/lib/work"
import { IssueContextMenu } from "./issue-actions"
import { TaskSheet } from "@/components/work/task-sheet"
import { IssueFormDialog } from "./issue-form-dialog"
import { PRIORITY_MARK, TYPE_DOT, formatAICost, formatAgentTime, issueSeconds } from "./shared"

// Items per board column per page.
const PAGE = 20

/** fadymondy.com's issue board, scoped to one Mahaam project. */
export function IssuesView({ projectId, title }: { projectId: string; title?: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const canWrite = ws.can("feedback:write")
  useDocumentTitle(`${t("issues.title")}${title ? ` · ${title}` : ""} · ${ws.summary.name}`)
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [priorityFilter, setPriorityFilter] = useState("all")

  // Debounced, so typing does not fire a query per keystroke. Filters go to the server.
  const [debouncedQuery, setDebouncedQuery] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [query])

  // The project board is the one board: issues filed as issues (SDK, portal, MCP, in-app) and
  // items created here, all the same thing.
  // Each column shows its first `perColumn` items; scrolling to a column's end loads the next page.
  const [perColumn, setPerColumn] = useState(PAGE)
  useEffect(() => setPerColumn(PAGE), [projectId, debouncedQuery, typeFilter, priorityFilter])
  const list = useIssues(ws.id, {
    project: projectId,
    include_board: "true",
    per_column: String(perColumn),
    q: debouncedQuery || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    priority: priorityFilter === "all" ? undefined : priorityFilter,
  })
  const issues = useMemo(() => list.data?.issues ?? [], [list.data])
  const refresh = () => list.mutate()

  const [creating, setCreating] = useState(false)
  // Clicking a card opens it here; the sheet's arrow is the way to the page.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const [dragging, setDragging] = useState<Issue | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  // Where in the target column the card would land. null means "at the end".
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // dnd-kit (pointer events), not the HTML5 drag API: that one never fires on touch screens and
  // is unreliable when the press starts on the card's title button.
  // Touch waits for a press-and-hold, so a swipe still scrolls the column.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  // The card under the pointer wins over its column; a column's empty space drops at its end.
  const collide: CollisionDetection = (args) => {
    const hits = pointerWithin(args)
    const cards = hits.filter((h) => String(h.id).startsWith("card:"))
    if (cards.length) return cards
    return hits.length ? hits : rectIntersection(args)
  }
  const onDragMove = ({ active, over }: DragMoveEvent) => {
    const data = over?.data.current as { status: string; index?: number } | undefined
    if (!data) {
      setDragOverStatus(null)
      setDropIndex(null)
      return
    }
    setDragOverStatus(data.status)
    if (data.index === undefined) {
      setDropIndex(null)
      return
    }
    const me = active.rect.current.translated
    const mid = me ? me.top + me.height / 2 : 0
    setDropIndex(mid > over!.rect.top + over!.rect.height / 2 ? data.index + 1 : data.index)
  }
  const endDrag = () => {
    setDragging(null)
    setDragOverStatus(null)
    setDropIndex(null)
  }
  const onDragEnd = ({ over }: DragEndEvent) => {
    const status = (over?.data.current as { status?: string } | undefined)?.status
    if (dragging && status) void dropCard(dragging, status, dropIndex)
    endDrag()
  }

  // The project's columns ARE the workflow (Settings → Board columns): the board renders them,
  // in their order, with their names and colours. An item sits in its card's column.
  const project = useProject(ws.id, projectId)
  const columns = useMemo(() => [...(project.data?.statuses ?? [])].sort((a, b) => a.position - b.position), [project.data])
  const columnOf = (i: Issue) => i.column_id ?? columns.find((c) => c.stage === i.status)?.id ?? columns[0]?.id ?? ""
  const byStatus = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const c of columns) map.set(c.id, [])
    for (const i of [...issues].sort((a, b) => a.sort_order - b.sort_order)) {
      const col = i.column_id ?? columns.find((c) => c.stage === i.status)?.id ?? columns[0]?.id ?? ""
      map.get(col)?.push(i)
    }
    return map
  }, [issues, columns])

  /** Move a card locally, so the board does not wait on a round-trip mid-drag. */
  function moveLocally(issue: Issue, to: string, at: number | null) {
    const column = (byStatus.get(to) ?? []).filter((r) => r.key !== issue.key)
    const index = at === null ? column.length : Math.max(0, Math.min(at, column.length))
    const before = column[index - 1]
    const after = column[index]
    const rank = before && after ? (before.sort_order + after.sort_order) / 2 : before ? before.sort_order + 1 : after ? after.sort_order - 1 : 0
    void list.mutate(
      (prev) => prev && { issues: prev.issues.map((r) => (r.key === issue.key ? { ...r, column_id: to, status: (columns.find((c) => c.id === to)?.stage ?? r.status) as IssueStatus, sort_order: rank } : r)) },
      { revalidate: false },
    )
  }

  async function changeStatus(key: string, status: string) {
    const issue = issues.find((r) => r.key === key)
    if (!issue || columnOf(issue) === status) return
    moveLocally(issue, status, null)
    try {
      await w.post(ws.id, `/api/w/tasks/${encodeURIComponent(key)}/move`, { status })
    } catch (err) {
      toast.error(errorText(err, t("issues.moveFailed")))
    }
    await refresh()
  }

  /**
   * Drop a card into a column at a position. The server ranks it between its
   * neighbours: "just before" the card it lands on, "just after" the last one,
   * or the end of an empty column.
   */
  async function dropCard(issue: Issue, status: string, index: number | null) {
    // index counts the column as drawn, dragged card included; below it, one slot is its own.
    const drawn = byStatus.get(status) ?? []
    const self = drawn.findIndex((r) => r.key === issue.key)
    if (index !== null && self >= 0 && self < index) index--
    const column = drawn.filter((r) => r.key !== issue.key)
    const at = index === null ? column.length : Math.max(0, Math.min(index, column.length))
    const before = column[at - 1]
    const after = column[at]

    const from = columnOf(issue)
    const current = byStatus.get(from) ?? []
    const was = current.findIndex((r) => r.key === issue.key)
    if (from === status && current[was - 1]?.key === before?.key && current[was + 1]?.key === after?.key) return

    moveLocally(issue, status, at)
    try {
      // The column first (the item takes the column's workflow stage), then its place in it.
      if (from !== status) await w.post(ws.id, `/api/w/tasks/${encodeURIComponent(issue.key)}/move`, { status })
      if (after || before) await issuesApi.move(ws.id, issue.key, after ? { before: after.key } : { after: before!.key })
    } catch (err) {
      toast.error(errorText(err, t("issues.moveFailed")))
    }
    await refresh()
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-8"
            type="search"
            value={query}
            placeholder={t("issues.search")}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("issues.search")}
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
          <SelectTrigger className="w-auto gap-1.5" aria-label={t("issues.typeLabel")}>
            <SelectValue>{(v) => (v === "all" ? t("issues.allTypes") : t(`issues.type.${String(v)}`))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("issues.allTypes")}</SelectItem>
            {ISSUE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`issues.type.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v ?? "all")}>
          <SelectTrigger className="w-auto gap-1.5" aria-label={t("issues.priorityLabel")}>
            <SelectValue>{(v) => (v === "all" ? t("issues.allPriorities") : t(`issues.priority.${String(v)}`))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("issues.allPriorities")}</SelectItem>
            {ISSUE_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {t(`issues.priority.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canWrite ? (
          <Button variant="primary" className="gap-2" onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("issues.new")}
          </Button>
        ) : null}
      </div>

      {list.error ? (
        <ErrorState error={list.error} />
      ) : !list.data ? (
        <div className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-none border-b border-border" />
          ))}
        </div>
      ) : (
        /* Columns scroll horizontally; each is a fixed width so cards stay legible. */
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          onDragStart={({ active }) => setDragging(issues.find((i) => i.key === active.id) ?? null)}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={endDrag}
        >
        <div className="flex flex-1 overflow-hidden">
          {columns.map((column) => {
            const status = column.id
            const cards = byStatus.get(status) ?? []
            const isTarget = dragOverStatus === status
            const total = Math.max(list.data?.column_totals?.[status] ?? 0, cards.length)

            return (
              <DropColumn
                key={status}
                status={status}
                className={cn(
                  "flex max-h-[calc(100vh-12rem)] min-w-0 flex-1 basis-0 flex-col border-e border-border transition-colors last:border-e-0",
                  isTarget && "bg-nq-action/[0.06] inset-ring-1 inset-ring-nq-action/40",
                )}
              >
                <h2 className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 font-mono text-xs tracking-wider text-muted-foreground uppercase">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ColorDot color={column.color} className="size-2" />
                    <span className="truncate" dir="auto">{column.name}</span>
                  </span>
                  <span dir="ltr" className="tabular-nums">
                    {total}
                  </span>
                </h2>

                <div className="flex flex-1 flex-col divide-y divide-line overflow-y-auto">
                  {cards.map((issue, index) => (
                    <DragCard key={issue.key} id={issue.key} status={status} index={index} disabled={!canWrite}>
                      {/* The landing line, drawn on the edge it would land on. */}
                      {isTarget && dropIndex === index ? <span aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 bg-nq-action" /> : null}
                      {isTarget && dropIndex === index + 1 && index === cards.length - 1 ? (
                        <span aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-nq-action" />
                      ) : null}

                      <IssueCard
                        issue={issue}
                        canWrite={canWrite}
                        dragging={dragging?.key === issue.key}
                        columns={columns}
                        column={status}
                        onStatusChange={(s) => void changeStatus(issue.key, s)}
                        onOpen={() => setSelectedKey(issue.key)}
                        onChanged={refresh}
                      />
                    </DragCard>
                  ))}
                  {total > cards.length ? (
                    <LoadMore loading={list.isValidating} onVisible={() => setPerColumn((n) => (cards.length >= n ? n + PAGE : n))} />
                  ) : null}
                  {/* The empty space under the last card drops at the end. */}
                  <div className="min-h-12 flex-1" />
                </div>
              </DropColumn>
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="w-64 border border-nq-action bg-background px-3 py-2.5 text-sm font-medium shadow-lg" dir="auto">
              {dragging.title}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
      )}

      <IssueFormDialog open={creating} onOpenChange={setCreating} projectId={projectId} onSaved={refresh} />

      <TaskSheet taskKey={selectedKey} onClose={() => setSelectedKey(null)} onOpen={setSelectedKey} onChanged={() => void refresh()} />
    </>
  )
}

function DropColumn({ status, className, children }: { status: string; className: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `column:${status}`, data: { status } })
  return (
    <section ref={setNodeRef} className={className} data-status-id={status}>
      {children}
    </section>
  )
}

function DragCard({ id, status, index, disabled, children }: { id: string; status: string; index: number; disabled: boolean; children: ReactNode }) {
  const drag = useDraggable({ id, disabled, data: { status, index } })
  const drop = useDroppable({ id: `card:${id}`, data: { status, index } })
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node)
        drop.setNodeRef(node)
      }}
      {...drag.attributes}
      {...drag.listeners}
      role={undefined}
      tabIndex={undefined}
      className="relative"
      data-task-key={id}
    >
      {children}
    </div>
  )
}

function IssueCard({
  issue,
  canWrite,
  dragging,
  onStatusChange,
  columns,
  column,
  onOpen,
  onChanged,
}: {
  columns: Status[]
  column: string
  issue: Issue
  canWrite: boolean
  dragging: boolean
  onStatusChange: (status: string) => void
  onOpen: () => void
  onChanged: () => void | Promise<unknown>
}) {
  const { t } = useTranslations()
  const mark = PRIORITY_MARK[issue.priority]
  const busy = Boolean(issue.started_at)
  const agentTime = busy ? formatAgentTime(issueSeconds(issue)) || "0m" : formatAgentTime(issue.agent_seconds)
  const aiCost = formatAICost(issue)

  return (
    <IssueContextMenu issue={issue} onChanged={onChanged}>
      <article
        className={cn(
          "group/issue flex flex-col gap-2 px-3 py-2.5 transition-[opacity,background-color] duration-150",
          canWrite && "cursor-grab active:cursor-grabbing",
          "hover:bg-muted",
          dragging && "opacity-40",
          busy && "border-s-2 border-nq-action ps-[calc(0.75rem-2px)]",
        )}
      >
        <button type="button" dir="auto" onClick={onOpen} className="text-start text-sm font-medium text-pretty hover:underline">
          {issue.title}
        </button>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
          <span dir="ltr">{issue.key}</span>

          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0", TYPE_DOT[issue.issue_type] ?? "bg-nq-fg-muted")} aria-hidden />
            {t(`issues.type.${issue.issue_type}`)}
          </span>

          {mark ? (
            <span className={cn("flex items-center gap-0.5", mark.tone)}>
              <mark.Icon className="size-3.5" />
              {t(`issues.priority.${issue.priority}`)}
            </span>
          ) : null}

          {issue.human_only ? (
            <span className="flex items-center gap-1" title={t("issues.humanOnly")}>
              <UserRoundIcon className="size-3" />
            </span>
          ) : null}

          {agentTime ? (
            <span className={cn("flex items-center gap-1", busy && "text-nq-accent-text")} title={t("issues.agentTime")}>
              <ClockIcon className="size-3" />
              <span dir="ltr">{agentTime}</span>
            </span>
          ) : null}

          {aiCost ? (
            <span className="flex items-center gap-1" title={t("issues.aiCost")}>
              <SparklesIcon className="size-3" />
              <span dir="ltr">{aiCost}</span>
            </span>
          ) : null}
        </div>

        {issue.route || issue.page_url ? (
          <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground/70">
            {issue.route ?? issue.page_url}
          </p>
        ) : null}

        <Select value={column} disabled={!canWrite} onValueChange={(v) => onStatusChange(String(v ?? column))}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v) => columns.find((c) => c.id === v)?.name ?? ""}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {columns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </article>
    </IssueContextMenu>
  )
}

/** The end of a column that holds more than it shows: loads the next page when scrolled into view. */
function LoadMore({ loading, onVisible }: { loading: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onVisible)
  cb.current = onVisible
  useEffect(() => {
    const el = ref.current
    if (!el || loading) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { rootMargin: "200px" })
    io.observe(el)
    return () => io.disconnect()
  }, [loading])
  return (
    <div ref={ref} className="flex justify-center py-3">
      <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}
