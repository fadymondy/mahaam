"use client"

// The activity feed: server entries (internal/work/activity.go) rendered as sentences in the UI
// language. Every sentence is a dictionary key per action, filled from the entry's changes.
import { BotIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { PersonAvatar, type Directory } from "@/components/work/people"
import { timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import type { Activity } from "@/lib/work"

const TASK_FIELDS = ["title", "description", "priority", "due_at", "estimate_minutes", "parent_id", "status"]

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : ""
}

export function ActivityFeed({
  items,
  loading,
  error,
  dir,
  showTask = true,
  emptyTitle,
}: {
  items: Activity[] | undefined
  loading: boolean
  error: unknown
  dir: Directory
  showTask?: boolean
  emptyTitle?: string
}) {
  const { t, locale } = useTranslations()
  if (error) return <ErrorState error={error} />
  if (loading) return <LoadingRows rows={3} />
  if (!items?.length) return <EmptyState title={emptyTitle ?? t("activity.empty")} />

  function sentence(a: Activity) {
    const c = a.changes
    const vars: Record<string, string> = {
      key: str(c.key),
      title: str(c.title),
      name: str(c.name),
      from: str(c.from),
      to: str(c.to),
      status: str(c.status),
      item: str(c.item),
      file: str(c.file),
      team: str(c.team),
      role: c.role ? t(`projectRole.${str(c.role)}`) : "",
      user: c.user_id ? dir.name(str(c.user_id)) : "",
    }
    if (a.action === "task.updated") {
      const fields = TASK_FIELDS.filter((f) => f in c).map((f) => t(`field.${f}`))
      vars.fields = fields.join(locale === "ar" ? "، " : ", ")
    }
    if (a.action === "task.assigned" || a.action === "task.labeled") {
      vars.added = String((c.added as unknown[] | undefined)?.length ?? 0)
      vars.removed = String((c.removed as unknown[] | undefined)?.length ?? 0)
    }
    const k = showTask || !vars.key ? `activity.${a.action}` : `activity.${a.action}.here`
    const text = t(k, vars)
    return text === k ? t("activity.generic", { action: a.action }) : text
  }

  return (
    <ol className="divide-y divide-line border-y border-line" aria-label={t("activity.title")}>
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 px-6 py-3 text-sm" data-action={a.action}>
          <PersonAvatar id={a.actor_id} dir={dir} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-grid-body">
              <span className="font-medium text-grid-fg" dir="ltr">
                {dir.name(a.actor_id)}
              </span>{" "}
              {sentence(a)}
              {a.via === "mcp" ? (
                <Badge variant="outline" className="ms-2 gap-1 align-middle">
                  <BotIcon />
                  {t("activity.viaMcp")}
                </Badge>
              ) : null}
            </p>
            {typeof a.changes.excerpt === "string" && a.changes.excerpt ? (
              <p className="mt-1 line-clamp-2 border-s-2 border-line ps-2 text-grid-muted">{a.changes.excerpt}</p>
            ) : null}
          </div>
          <time className="shrink-0 text-meta text-grid-muted" dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>
            <Ltr>{timeAgo(a.created_at, locale)}</Ltr>
          </time>
        </li>
      ))}
    </ol>
  )
}
