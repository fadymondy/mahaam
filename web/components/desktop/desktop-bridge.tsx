"use client"

// The console's side of the desktop app (apps/desktop). In a browser window.mahaamDesktop is absent
// and all of this is inert.
//
// The desktop app is this same console in a native window, so the page owns the data and the
// window owns the chrome. The page tells the window its theme, language, unread count and running
// timer (the menu-bar timer is drawn from it, live, because this page already holds the live
// stream), and the window hands back menu and tray commands.
import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import useSWR from "swr"
import { toast } from "sonner"

import { useTimerActions } from "@/components/time/timer-bar"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { switchLocale } from "@/components/header-controls"
import { useInbox, type StartBody, type TimeEntry } from "@/lib/time"

type Theme = "light" | "dark" | "system"
type Command = { type: string; [key: string]: unknown }

/** What the menu-bar timer shows. Times are ISO strings; the window ticks the clock itself. */
export type DesktopTimer = {
  running: { what: string; where: string; started_at: string } | null
  recent: { label: string; sub: string; body: StartBody }[]
  workspace: string
}

type DesktopApi = {
  platform: string
  setTheme(theme: Theme): void
  setLocale(locale: string): void
  setBadge(count: number): void
  setTimer(timer: DesktopTimer | null): void
  onCommand(cb: (command: Command) => void): () => void
}

declare global {
  interface Window {
    mahaamDesktop?: DesktopApi
  }
}

export const inDesktop = () => typeof window !== "undefined" && !!window.mahaamDesktop

/** Events the shell and the timer bar listen for, so a menu item and a shortcut do the same thing. */
export const DESKTOP_EVENT = {
  toggleNav: "mahaam:toggle-nav",
  report: "mahaam:report",
  timerPalette: "mahaam:timer-palette",
} as const

const SECTIONS: Record<string, string> = {
  overview: "",
  projects: "/projects",
  time: "/time",
  reports: "/reports",
  members: "/members",
  me: "/me",
}

/** Theme, language and menu commands. Mounted once, for every page (signed in or not). */
export function DesktopBridge() {
  const { theme, setTheme } = useTheme()
  const { t, locale } = useTranslations()
  const pathname = usePathname()
  const router = useRouter()
  const path = useRef(pathname)
  path.current = pathname

  useEffect(() => {
    const d = window.mahaamDesktop
    if (!d) return
    document.documentElement.dataset.desktop = d.platform
  }, [])

  useEffect(() => {
    if (theme === "light" || theme === "dark" || theme === "system") window.mahaamDesktop?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    window.mahaamDesktop?.setLocale(locale)
  }, [locale])

  useEffect(() => {
    const d = window.mahaamDesktop
    if (!d) return
    return d.onCommand((c) => {
      const slug = /^\/(?:en|ar)\/w\/([^/]+)/.exec(path.current)?.[1]
      const base = slug ? `/${locale}/w/${slug}` : null
      switch (c.type) {
        case "go": {
          const section = String(c.section)
          if (section === "privacy" || section === "terms") router.push(`/${locale}/legal/${section}`)
          else if (section === "workspaces" || !base) router.push(`/${locale}/workspaces`)
          else if (section in SECTIONS) router.push(base + SECTIONS[section])
          break
        }
        case "theme":
          if (c.theme === "light" || c.theme === "dark" || c.theme === "system") setTheme(c.theme)
          break
        case "locale":
          if (typeof c.locale === "string") switchLocale(path.current, locale, c.locale)
          break
        case "copy-link":
          void navigator.clipboard.writeText(window.location.href).then(() => toast.success(t("common.copied")))
          break
        case "fullscreen":
          document.documentElement.toggleAttribute("data-fullscreen", !!c.value)
          break
        case "toggle-nav":
          window.dispatchEvent(new Event(DESKTOP_EVENT.toggleNav))
          break
        case "report":
          window.dispatchEvent(new Event(DESKTOP_EVENT.report))
          break
        case "palette":
          window.dispatchEvent(new Event(DESKTOP_EVENT.timerPalette))
          break
      }
    })
  }, [router, locale, setTheme, t])

  return null
}

function label(e: Pick<TimeEntry, "description" | "task_title" | "project_name">, fallback: string) {
  return e.description || e.task_title || e.project_name || fallback
}

/**
 * The running timer, recent work and unread count, for the menu bar and the dock. Mounted inside
 * the workspace shell (it needs the workspace), only in the desktop app.
 */
export function DesktopWorkspaceSync() {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const canTrack = ws.can("time:track")
  const { timer, start, stop } = useTimerActions()
  const inbox = useInbox(ws.id)
  // The prefix /api/w/time/ is revalidated by every timer change (useRefreshTime), so this list
  // follows starts and stops without a subscription of its own.
  const recent = useSWR<{ entries: TimeEntry[] }>(canTrack ? ["/api/w/time/entries?limit=40", ws.id] : null, ([p, id]: [string, string]) =>
    api(p, { workspaceId: id }),
  )
  const unread = inbox.data?.unread ?? 0

  useEffect(() => {
    window.mahaamDesktop?.setBadge(unread)
  }, [unread])

  const untitled = t("timer.running")
  useEffect(() => {
    const d = window.mahaamDesktop
    if (!d) return
    if (!canTrack) return d.setTimer(null)
    const seen = new Set<string>()
    const items: DesktopTimer["recent"] = []
    for (const e of recent.data?.entries ?? []) {
      if (!e.ended_at) continue
      const key = `${e.task_id ?? ""}|${e.project_id ?? ""}|${e.description}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        label: label(e, untitled),
        sub: [e.task_key, e.project_name].filter(Boolean).join(" · "),
        body: {
          ...(e.task_id ? { task: e.task_id } : e.project_id ? { project: e.project_id } : {}),
          ...(e.description ? { description: e.description } : {}),
          billable: e.billable,
        },
      })
      if (items.length === 5) break
    }
    d.setTimer({
      workspace: ws.summary.name,
      running: timer
        ? { what: label(timer, untitled), where: [timer.task_key, timer.project_name].filter(Boolean).join(" · "), started_at: timer.started_at }
        : null,
      recent: items,
    })
  }, [canTrack, timer, recent.data, ws.summary.name, untitled])

  // Leaving the workspace (sign-out, the workspace list) empties the menu bar.
  useEffect(() => () => window.mahaamDesktop?.setTimer(null), [])

  const actions = useRef({ start, stop })
  actions.current = { start, stop }
  useEffect(() => {
    const d = window.mahaamDesktop
    if (!d) return
    return d.onCommand((c) => {
      if (c.type === "timer-stop") void actions.current.stop()
      else if (c.type === "timer-start" && c.body && typeof c.body === "object") void actions.current.start(c.body as StartBody)
    })
  }, [])

  return null
}
