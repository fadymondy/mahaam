"use client"

import { useEffect, useMemo, useState } from "react"
import { ClockIcon, PlusIcon, SearchIcon, UserRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/states"
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
  type Issue,
  type IssueStatus,
} from "@/lib/work"
import { IssueContextMenu } from "./issue-actions"
import { IssueFormDialog } from "./issue-form-dialog"
import { IssueSheet } from "./issue-sheet"
import { PRIORITY_MARK, TYPE_DOT, formatAgentTime } from "./shared"

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
  const list = useIssues(ws.id, {
    project: projectId,
    include_board: "true",
    q: debouncedQuery || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    priority: priorityFilter === "all" ? undefined : priorityFilter,
  })
  const issues = useMemo(() => list.data?.issues ?? [], [list.data])
  const refresh = () => list.mutate()

  const [creating, setCreating] = useState(false)
  // Clicking a card opens it here; the sheet's arrow is the way to the page.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = useMemo(() => issues.find((i) => i.key === selectedKey) ?? null, [issues, selectedKey])
  const [lastSelected, setLastSelected] = useState<Issue | null>(null)
  useEffect(() => {
    if (selected) setLastSelected(selected)
  }, [selected])

  const [dragging, setDragging] = useState<Issue | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  // Where in the target column the card would land. null means "at the end".
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const byStatus = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const s of ISSUE_STATUSES) map.set(s, [])
    for (const i of [...issues].sort((a, b) => a.sort_order - b.sort_order)) map.get(i.status)?.push(i)
    return map
  }, [issues])

  /** Move a card locally, so the board does not wait on a round-trip mid-drag. */
  function moveLocally(issue: Issue, to: IssueStatus, at: number | null) {
    const column = (byStatus.get(to) ?? []).filter((r) => r.key !== issue.key)
    const index = at === null ? column.length : Math.max(0, Math.min(at, column.length))
    const before = column[index - 1]
    const after = column[index]
    const rank = before && after ? (before.sort_order + after.sort_order) / 2 : before ? before.sort_order + 1 : after ? after.sort_order - 1 : 0
    void list.mutate(
      (prev) => prev && { issues: prev.issues.map((r) => (r.key === issue.key ? { ...r, status: to, sort_order: rank } : r)) },
      { revalidate: false },
    )
  }

  async function changeStatus(key: string, status: string) {
    const issue = issues.find((r) => r.key === key)
    if (!issue || issue.status === status) return
    moveLocally(issue, status as IssueStatus, null)
    try {
      await issuesApi.move(ws.id, key, { status: status as IssueStatus })
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
  async function dropCard(issue: Issue, status: IssueStatus, index: number | null) {
    const column = (byStatus.get(status) ?? []).filter((r) => r.key !== issue.key)
    const at = index === null ? column.length : Math.max(0, Math.min(index, column.length))
    const before = column[at - 1]
    const after = column[at]

    const current = byStatus.get(issue.status) ?? []
    const was = current.findIndex((r) => r.key === issue.key)
    if (issue.status === status && current[was - 1]?.key === before?.key && current[was + 1]?.key === after?.key) return

    moveLocally(issue, status, at)
    try {
      await issuesApi.move(ws.id, issue.key, after ? { before: after.key } : before ? { after: before.key } : { status })
    } catch (err) {
      toast.error(errorText(err, t("issues.moveFailed")))
    }
    await refresh()
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-grid-muted" />
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
          <Button className="gap-2" onClick={() => setCreating(true)}>
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
            <Skeleton key={i} className="h-16 w-full rounded-none border-b border-line" />
          ))}
        </div>
      ) : (
        /* Columns scroll horizontally; each is a fixed width so cards stay legible. */
        <div className="flex flex-1 overflow-x-auto">
          {ISSUE_STATUSES.map((status) => {
            const cards = byStatus.get(status) ?? []
            const isTarget = dragOverStatus === status

            return (
              <section
                key={status}
                className={cn(
                  "flex max-h-[calc(100vh-12rem)] w-72 shrink-0 flex-col border-e border-line transition-colors",
                  isTarget && "bg-grid-action/[0.06] inset-ring-1 inset-ring-grid-action/40",
                )}
                onDragOver={(e) => {
                  if (!dragging) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  setDragOverStatus(status)
                }}
                onDragLeave={(e) => {
                  // Only when the pointer actually leaves the column, not a child card.
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return
                  setDragOverStatus((s) => (s === status ? null : s))
                  setDropIndex(null)
                }}
                onDrop={() => {
                  if (dragging) void dropCard(dragging, status, dropIndex)
                  setDragging(null)
                  setDragOverStatus(null)
                  setDropIndex(null)
                }}
              >
                <h2 className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 font-mono text-[11px] tracking-wider text-grid-muted uppercase">
                  {t(`issues.status.${status}`)}
                  <span dir="ltr" className="tabular-nums">
                    {cards.length}
                  </span>
                </h2>

                <div className="flex flex-1 flex-col divide-y divide-line overflow-y-auto">
                  {cards.map((issue, index) => (
                    <div
                      key={issue.key}
                      className="relative"
                      onDragOver={(e) => {
                        if (!dragging) return
                        e.preventDefault()
                        e.stopPropagation()
                        setDragOverStatus(status)
                        // Above or below the midpoint decides which side of this card the drop lands on.
                        const box = e.currentTarget.getBoundingClientRect()
                        const after = e.clientY > box.top + box.height / 2
                        setDropIndex(after ? index + 1 : index)
                      }}
                    >
                      {/* The landing line, drawn on the edge it would land on. */}
                      {isTarget && dropIndex === index ? <span aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 bg-grid-action" /> : null}
                      {isTarget && dropIndex === index + 1 && index === cards.length - 1 ? (
                        <span aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-grid-action" />
                      ) : null}

                      <IssueCard
                        issue={issue}
                        canWrite={canWrite}
                        onDragStart={() => setDragging(issue)}
                        onDragEnd={() => {
                          setDragging(null)
                          setDragOverStatus(null)
                          setDropIndex(null)
                        }}
                        onStatusChange={(s) => void changeStatus(issue.key, s)}
                        onOpen={() => setSelectedKey(issue.key)}
                        onChanged={refresh}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <IssueFormDialog open={creating} onOpenChange={setCreating} projectId={projectId} onSaved={refresh} />

      <IssueSheet
        issue={selected ?? lastSelected}
        open={selectedKey !== null}
        onOpenChange={(next) => !next && setSelectedKey(null)}
        onChanged={refresh}
      />
    </>
  )
}

function IssueCard({
  issue,
  canWrite,
  onDragStart,
  onDragEnd,
  onStatusChange,
  onOpen,
  onChanged,
}: {
  issue: Issue
  canWrite: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onStatusChange: (status: string) => void
  onOpen: () => void
  onChanged: () => void | Promise<unknown>
}) {
  const { t } = useTranslations()
  const [dragging, setDragging] = useState(false)
  const mark = PRIORITY_MARK[issue.priority]
  const agentTime = formatAgentTime(issue.agent_seconds)
  const busy = Boolean(issue.started_at && !issue.finished_at)

  return (
    <IssueContextMenu issue={issue} onChanged={onChanged}>
      <article
        draggable={canWrite}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move"
          e.dataTransfer.setData("text/plain", issue.key)

          const node = e.currentTarget as HTMLElement
          const box = node.getBoundingClientRect()

          // Snapshot a DETACHED CLONE, not the live node: the live card is about to
          // change (opacity-40), and the ghost would drift away from the cursor.
          const ghost = node.cloneNode(true) as HTMLElement
          ghost.style.width = `${box.width}px`
          ghost.style.height = `${box.height}px`
          ghost.style.position = "fixed"
          ghost.style.top = "-10000px"
          ghost.style.left = "-10000px"
          ghost.style.opacity = "1"
          ghost.style.pointerEvents = "none"
          ghost.style.background = "var(--background)"
          ghost.style.border = "1px solid var(--grid-action)"
          document.body.appendChild(ghost)
          e.dataTransfer.setDragImage(ghost, e.clientX - box.left, e.clientY - box.top)
          requestAnimationFrame(() => ghost.remove())

          setDragging(true)
          onDragStart()
        }}
        onDragEnd={() => {
          setDragging(false)
          onDragEnd()
        }}
        className={cn(
          "group/issue flex flex-col gap-2 px-3 py-2.5 transition-[opacity,background-color] duration-150",
          canWrite && "cursor-grab active:cursor-grabbing",
          "hover:bg-grid-soft",
          dragging && "opacity-40",
          busy && "border-s-2 border-grid-action ps-[calc(0.75rem-2px)]",
        )}
      >
        <button type="button" dir="auto" onClick={onOpen} className="text-start text-sm font-medium text-pretty hover:underline">
          {issue.title}
        </button>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-grid-muted">
          <span dir="ltr">{issue.key}</span>

          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0", TYPE_DOT[issue.issue_type] ?? "bg-grid-muted")} aria-hidden />
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
            <span className={cn("flex items-center gap-1", busy && "text-grid-action")} title={t("issues.agentTime")}>
              <ClockIcon className="size-3" />
              <span dir="ltr">{agentTime}</span>
            </span>
          ) : null}
        </div>

        {issue.route || issue.page_url ? (
          <p dir="ltr" className="truncate font-mono text-[10px] text-grid-muted/70">
            {issue.route ?? issue.page_url}
          </p>
        ) : null}

        <Select value={issue.status} disabled={!canWrite} onValueChange={(v) => onStatusChange(v ?? issue.status)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue>{(v) => t(`issues.status.${String(v)}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ISSUE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`issues.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </article>
    </IssueContextMenu>
  )
}
