"use client"

import { Suspense, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { timeAgo } from "@/lib/format"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import { ISSUE_PRIORITIES, ISSUE_STATUSES, useIssues, type Issue } from "@/lib/work"

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-grid-danger",
  high: "text-(--pal-orange)",
  medium: "text-(--pal-amber)",
  low: "text-grid-muted",
}

export default function IssuesPage() {
  return (
    <Suspense>
      <IssuesBoard />
    </Suspense>
  )
}

function IssuesBoard() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("issues.title")} · ${ws.summary.name}`)
  const [q, setQ] = useState("")
  const [priority, setPriority] = useState("")
  const [type, setType] = useState("")
  const issues = useIssues(ws.id, { q: q.trim() || undefined, priority: priority || undefined, type: type || undefined })

  const priorityItems = [{ value: "", label: t("issues.allPriorities") }, ...ISSUE_PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) }))]
  const list = issues.data?.issues ?? []

  return (
    <>
      <SectionHeader micro={ws.summary.name} title={t("issues.title")} description={t("issues.hint")} />

      <div className="flex flex-wrap items-center gap-2 border-y border-line px-6 py-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("issues.search")}
          className="h-9 w-full sm:w-64"
          dir="auto"
        />
        <Select items={priorityItems} value={priority} onValueChange={(v) => setPriority(String(v ?? ""))}>
          <SelectTrigger className="h-9 w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {priorityItems.map((p) => (
              <SelectItem key={p.value || "all"} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder={t("issues.typeFilter")}
          className="h-9 w-full sm:w-40"
          dir="auto"
        />
      </div>

      {issues.error ? (
        <ErrorState error={issues.error} />
      ) : issues.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.length === 0 ? (
        <EmptyState title={t("issues.empty")} body={t("issues.emptyBody")} />
      ) : (
        <div className="flex gap-px overflow-x-auto border-b border-line bg-grid-line">
          {ISSUE_STATUSES.map((status) => {
            const col = list.filter((i) => i.status === status)
            return (
              <section key={status} className="flex w-72 shrink-0 flex-col bg-grid-bg">
                <h2 className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-2.5 grid-micro">
                  <span>{t(`issues.status.${status}`)}</span>
                  <span className="tabular-nums text-grid-muted">
                    <Ltr>{col.length}</Ltr>
                  </span>
                </h2>
                <ul className="flex flex-1 flex-col divide-y divide-line">
                  {col.map((issue) => (
                    <IssueCard key={issue.key} issue={issue} base={`/${locale}/w/${ws.slug}/issues`} />
                  ))}
                  {col.length === 0 ? <li className="px-4 py-6 text-center text-xs text-grid-muted">{t("issues.emptyColumn")}</li> : null}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}

function IssueCard({ issue, base }: { issue: Issue; base: string }) {
  const { t, locale } = useTranslations()
  return (
    <li>
      <Link href={`${base}/${encodeURIComponent(issue.key)}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-grid-soft">
        <span className="line-clamp-2 text-sm font-medium text-grid-fg">{issue.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-grid-muted">
          <Ltr mono>{issue.key}</Ltr>
          {issue.issue_type ? <Badge variant="outline" className="text-[10px]">{issue.issue_type}</Badge> : null}
          <span className={cn("font-medium", PRIORITY_TONE[issue.priority] ?? "text-grid-muted")}>{t(`issues.priority.${issue.priority}`)}</span>
          <span aria-hidden className="text-grid-muted/50">·</span>
          <span>{timeAgo(issue.created_at, locale)}</span>
        </span>
        {issue.route || issue.page_url ? (
          <Ltr className="truncate text-[11px] text-grid-muted">{issue.route ?? issue.page_url}</Ltr>
        ) : null}
      </Link>
    </li>
  )
}
