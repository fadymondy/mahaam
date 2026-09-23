"use client"

// The List tab: every task of a project, grouped by status, filterable by text and assignee.
import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Ltr } from "@/components/copy-field"
import { EmptyState } from "@/components/states"
import { LabelChips, PriorityIcon } from "@/components/work/fields"
import { ColorDot } from "@/components/work/palette"
import { AvatarStack, type Directory } from "@/components/work/people"
import { formatDay, isOverdue } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Board, Label } from "@/lib/work"

export function TaskList({ board, labels, dir, onOpen }: { board: Board; labels: Label[]; dir: Directory; onOpen: (key: string) => void }) {
  const { t, locale } = useTranslations()
  const [q, setQ] = useState("")
  const [who, setWho] = useState("all")

  const tasks = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return board.tasks.filter(
      (task) =>
        (!needle || task.title.toLowerCase().includes(needle) || task.key.toLowerCase().includes(needle)) &&
        (who === "all" || (who === "none" ? task.assignee_ids.length === 0 : task.assignee_ids.includes(who === "me" ? (dir.me ?? "") : who))),
    )
  }, [board.tasks, q, who, dir.me])

  const whoItems = [
    { value: "all", label: t("list.everyone") },
    { value: "me", label: t("list.assignedToMe") },
    { value: "none", label: t("task.unassigned") },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("list.search")} aria-label={t("list.search")} className="ps-8" />
        </div>
        <Select items={whoItems} value={who} onValueChange={(v) => setWho(String(v ?? "all"))}>
          <SelectTrigger className="w-44" aria-label={t("task.assignees")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {whoItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title={board.tasks.length ? t("list.noMatch") : t("board.noTasks")} />
      ) : (
        board.statuses.map((s) => {
          const rows = tasks.filter((task) => task.status_id === s.id).sort((a, b) => a.position - b.position)
          if (!rows.length) return null
          return (
            <section key={s.id} aria-label={s.name}>
              <h2 className="flex items-center gap-2 border-b border-line bg-grid-soft px-6 py-2 text-sm font-medium">
                <ColorDot color={s.color} />
                {s.name}
                <span className="text-meta font-normal text-grid-muted">
                  <Ltr>{rows.length}</Ltr>
                </span>
              </h2>
              <Table>
                <TableHeader className="sr-only">
                  <TableRow>
                    <TableHead>{t("task.key")}</TableHead>
                    <TableHead>{t("task.title")}</TableHead>
                    <TableHead>{t("task.labels")}</TableHead>
                    <TableHead>{t("task.priority")}</TableHead>
                    <TableHead>{t("task.due")}</TableHead>
                    <TableHead>{t("task.assignees")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((task) => (
                    <TableRow
                      key={task.id}
                      data-task-key={task.key}
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => onOpen(task.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpen(task.key)
                      }}
                    >
                      <TableCell className="w-24 ps-6 text-meta text-grid-muted">
                        <Ltr mono>{task.key}</Ltr>
                      </TableCell>
                      <TableCell className={cn("max-w-md truncate font-medium", task.completed_at && "text-grid-muted line-through")}>{task.title}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <LabelChips ids={task.label_ids} labels={labels} />
                      </TableCell>
                      <TableCell className="w-10">
                        <PriorityIcon priority={task.priority} />
                      </TableCell>
                      <TableCell className={cn("w-28 text-meta", isOverdue(task.due_at, task.completed_at) ? "text-grid-danger-text" : "text-grid-muted")}>
                        {task.due_at ? <Ltr>{formatDay(task.due_at, locale, "short")}</Ltr> : null}
                      </TableCell>
                      <TableCell className="w-28 pe-6">
                        <AvatarStack ids={task.assignee_ids} dir={dir} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )
        })
      )}
    </>
  )
}
