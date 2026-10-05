"use client"

// The in-app inbox: Nasaq's NotificationCenter as a side-over from the header bell (All / Unread tabs, mark all
// read). Each kind gets its own icon and colour so a glance tells mentions, assignments, finished
// work, time reminders and budget alerts apart. Items are rendered in the UI language from
// kind + data, falling back to the server's title. New items arrive on the per-user live stream
// (notification.created), so the badge moves without a reload.
import { useRouter } from "next/navigation"
import type { ReactNode } from "react"
import {
  AtSignIcon,
  BellIcon,
  CheckCircle2Icon,
  ClockAlertIcon,
  InboxIcon,
  MessageSquareIcon,
  TimerIcon,
  TriangleAlertIcon,
  UserPlusIcon,
} from "lucide-react"
import { NotificationCenter, toast, type NotificationCenterItem } from "@fadymondy/nasaq/web"

import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { timeApi, useInbox, type AppNotification } from "@/lib/time"
import { cn } from "@/lib/utils"
import { errorText } from "@/lib/work"

// Tone per kind: info = someone needs you, success = work finished, warning = time to act,
// danger = over a limit, accent = requests from clients.
const KINDS: Record<string, { icon: ReactNode; tone: "info" | "success" | "warning" | "danger" | "accent" }> = {
  "task.mentioned": { icon: <AtSignIcon />, tone: "info" },
  "task.assigned": { icon: <UserPlusIcon />, tone: "info" },
  "task.commented": { icon: <MessageSquareIcon />, tone: "info" },
  "task.done": { icon: <CheckCircle2Icon />, tone: "success" },
  "task.completed": { icon: <CheckCircle2Icon />, tone: "success" },
  "timer.long_running": { icon: <TimerIcon />, tone: "warning" },
  "time.missing_day": { icon: <ClockAlertIcon />, tone: "warning" },
  "budget.threshold": { icon: <TriangleAlertIcon />, tone: "danger" },
}

const TONE = {
  info: "bg-nq-info-soft text-nq-info-text",
  success: "bg-nq-success-soft text-nq-success-text",
  warning: "bg-nq-warning-soft text-nq-warning-text",
  danger: "bg-nq-danger-soft text-nq-danger-text",
  accent: "bg-muted text-nq-accent-text",
  neutral: "bg-muted text-muted-foreground",
}

function KindIcon({ kind }: { kind: string }) {
  const k = KINDS[kind] ?? (kind.startsWith("request.") ? { icon: <InboxIcon />, tone: "accent" as const } : undefined)
  return (
    <span
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", TONE[k?.tone ?? "neutral"])}
      data-notification-kind={kind}
      data-tone={k?.tone ?? "neutral"}
      aria-hidden
    >
      {k?.icon ?? <BellIcon />}
    </span>
  )
}

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

  const byId = new Map(items.map((n) => [n.id, n]))
  const rows: NotificationCenterItem[] = items.map((n) => {
    const x = text(n)
    return { id: n.id, title: x.title, description: x.body || undefined, icon: <KindIcon kind={n.kind} />, time: n.created_at, unread: !n.read_at }
  })

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
    <NotificationCenter
      items={rows}
      unreadCount={unread}
      onItemClick={(row) => {
        const n = byId.get(row.id)
        if (n) void open(n)
      }}
      onMarkAllRead={readAll}
      variant="sheet"
      labels={{ title: t("notify.title"), markAllRead: t("notify.markAll"), emptyAll: t("notify.empty") }}
      data-notification-bell
      data-inbox
    />
  )
}
