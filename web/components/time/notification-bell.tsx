"use client"

// The in-app inbox under a bell in the header (plan: "Notifications"). Items are rendered in the UI
// language from kind + data, falling back to the server's title. New items arrive on the per-user
// live stream (notification.created), so the badge moves without a reload.
import { useRouter } from "next/navigation"
import { BellIcon, CheckCheckIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Popover, PopoverContent, PopoverTrigger } from "@fadymondy/nasaq/web"


import { Ltr } from "@/components/copy-field"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { timeApi, useInbox, type AppNotification } from "@/lib/time"
import { cn } from "@/lib/utils"
import { errorText } from "@/lib/work"

export function NotificationBell() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const inbox = useInbox(ws.id)
  const items = inbox.data?.notifications ?? []
  const unread = inbox.data?.unread ?? 0

  const text = (n: AppNotification) => {
    // Every scalar in data is a template variable (task.*: actor, task_key, task_title, excerpt;
    // budget.threshold: project_name, metric, threshold, percent); metric is localised.
    const vars: Record<string, string> = {}
    for (const [k, v] of Object.entries(n.data ?? {})) if (v != null && typeof v !== "object") vars[k] = String(v)
    if (n.kind.startsWith("task.") && !vars.actor) vars.actor = t("notify.someone")
    if (vars.metric === "hours" || vars.metric === "money") vars.metric = t(`notify.metric.${vars.metric}`)
    const title = t(`notify.${n.kind}`, vars)
    const body = t(`notify.${n.kind}.body`, vars)
    // A template whose variable is missing from data falls back to the server's text.
    const unfilled = (s: string) => /\{[a-z_]+\}/.test(s)
    return {
      title: title === `notify.${n.kind}` || unfilled(title) ? n.title : title,
      body: body === `notify.${n.kind}.body` || unfilled(body) ? (n.body ?? "") : body,
    }
  }

  async function open(n: AppNotification) {
    try {
      if (!n.read_at) await timeApi.read(ws.id, n.id)
      void inbox.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
    if (n.url) router.push(`/${locale}${n.url}`)
  }

  async function readAll() {
    try {
      await timeApi.readAll(ws.id)
      void inbox.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? `${t("notify.open")} — ${t("notify.unread", { n: unread })}` : t("notify.open")} data-notification-bell />}
      >
        <BellIcon />
        {unread ? (
          <span
            className="absolute -end-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-nq-action px-1 font-mono text-xs leading-none text-nq-on-action"
            data-unread={unread}
            dir="ltr"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0" data-inbox>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium">{t("notify.title")}</p>
          <Button variant="ghost" size="sm" disabled={!unread} onClick={readAll}>
            <CheckCheckIcon />
            {t("notify.markAll")}
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("notify.empty")}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {items.map((n) => {
              const x = text(n)
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn("flex w-full gap-3 px-4 py-3 text-start transition-colors hover:bg-muted", !n.read_at && "bg-muted/60")}
                    data-notification={n.kind}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-nq-action")} aria-hidden />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">{x.title}</span>
                      {x.body ? <span className="block text-caption text-muted-foreground">{x.body}</span> : null}
                      <Ltr className="block text-xs text-muted-foreground">{timeAgo(n.created_at, locale)}</Ltr>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
