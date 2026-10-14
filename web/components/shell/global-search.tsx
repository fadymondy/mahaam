"use client"

// Global search (⌘K / Ctrl+K): Nasaq's CommandPalette fed with this workspace's pages, its projects
// and — as you type — matching tasks. The timer's own palette moved to ⇧⌘K.
import { useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  BriefcaseIcon,
  ChartColumnIcon,
  CheckSquareIcon,
  ClockIcon,
  FolderKanbanIcon,
  HomeIcon,
  ReceiptTextIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"
import { CommandPalette, SearchTrigger, useRegisterCommands, useRegisterCommandSource, type Command } from "@fadymondy/nasaq/web"

import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useProjects, type Task } from "@/lib/work"

export function GlobalSearch() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const base = `/${locale}/w/${ws.slug}`
  // Clients are external: they get the portal only, and no task search.
  const isStaff = ws.can("members:read")
  const projects = useProjects(ws.id)

  const commands = useMemo<Command[]>(() => {
    if (!isStaff) return []
    const go = (href: string) => () => router.push(href)
    const pages: [string, string, Command["icon"], boolean][] = [
      ["home", base, HomeIcon, true],
      ["projects", `${base}/projects`, FolderKanbanIcon, true],
      ["members", `${base}/members`, UsersIcon, true],
      ["time", `${base}/time`, ClockIcon, ws.can("time:track")],
      ["reports", `${base}/reports`, ChartColumnIcon, ws.can("reports:read")],
      ["clients", `${base}/clients`, BriefcaseIcon, ws.can("clients:read")],
      ["invoices", `${base}/invoices`, ReceiptTextIcon, ws.can("invoices:read")],
      ["teams", `${base}/teams`, UsersRoundIcon, ws.can("teams:read")],
    ]
    const pageCmds = pages
      .filter(([, , , ok]) => ok)
      .map<Command>(([id, href, icon]) => ({
        id: `page-${id}`,
        label: t(id === "home" ? "nav.home" : id === "members" ? "nav.team" : id === "time" ? "nav.time" : `nav.${id}`),
        section: "pages",
        sectionLabel: t("shell.searchPages"),
        sectionOrder: 2,
        icon,
        perform: go(href),
      }))
    const projectCmds = (projects.data?.projects ?? []).map<Command>((p) => ({
      id: `project-${p.id}`,
      label: p.name,
      section: "projects",
      sectionLabel: t("shell.searchProjects"),
      sectionOrder: 1,
      icon: FolderKanbanIcon,
      keywords: [p.client_name ?? ""].filter(Boolean),
      hint: p.client_name ?? undefined,
      perform: go(`${base}/projects/${p.id}/board`),
    }))
    return [...projectCmds, ...pageCmds]
  }, [isStaff, projects.data, base, router, t, ws])
  useRegisterCommands(commands)

  useRegisterCommandSource(
    isStaff
      ? {
          id: "tasks",
          minQuery: 2,
          search: async (q, signal) => {
            const res = await api<{ tasks: Task[] | null }>(`/api/w/tasks?q=${encodeURIComponent(q)}&limit=8`, { workspaceId: ws.id, signal })
            return (res.tasks ?? []).map<Command>((x) => ({
              id: `task-${x.id}`,
              label: `${x.key}  ${x.title}`,
              section: "tasks",
              sectionLabel: t("shell.searchTasks"),
              sectionOrder: 0,
              icon: CheckSquareIcon,
              perform: () => router.push(`${base}/projects/${x.project_id}?task=${encodeURIComponent(x.key)}`),
            }))
          },
        }
      : null,
  )

  return (
    <>
      <SearchTrigger label={t("shell.search")} />
      <CommandPalette placeholder={t("shell.search")} emptyLabel={t("shell.searchEmpty")} labels={{ title: t("shell.searchLabel") }} />
    </>
  )
}
