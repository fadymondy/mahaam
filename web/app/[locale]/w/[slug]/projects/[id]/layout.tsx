"use client"

import Link from "next/link"
import { Suspense, useCallback, type ReactNode } from "react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeftIcon, GithubIcon, KeyRoundIcon, LayoutDashboardIcon, ReceiptTextIcon, SettingsIcon, SquareKanbanIcon, type LucideIcon } from "lucide-react"
import { useSWRConfig } from "swr"

import { Skeleton, Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"

import { NotFoundState } from "@/components/not-found-state"
import { ErrorState } from "@/components/states"
import { ProjectContext } from "@/components/work/project-context"
import { TaskSheet } from "@/components/work/task-sheet"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useProject } from "@/lib/work"
import { ProjectHeader, StatusPill } from "@/components/work/project/project-header"
import { ProjectAvatar } from "@/components/work/project-avatar"

const TABS = ["overview", "board", "github", "vault", "billing", "settings"] as const
type Tab = (typeof TABS)[number]
// The board route is the issues view (board and list of the same items), so its tab reads "Issues".
const TAB_LABEL: Record<Tab, string> = {
  overview: "projectTab.overview",
  board: "projectTab.issues",
  github: "projectTab.github",
  vault: "projectTab.vault",
  billing: "projectTab.billing",
  settings: "projectTab.settings",
}
const TAB_ICON: Record<Tab, LucideIcon> = {
  overview: LayoutDashboardIcon,
  board: SquareKanbanIcon,
  github: GithubIcon,
  vault: KeyRoundIcon,
  billing: ReceiptTextIcon,
  settings: SettingsIcon,
}

function ProjectShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const { mutate } = useSWRConfig()
  const project = useProject(ws.id, id)
  const base = `/${locale}/w/${ws.slug}/projects/${id}`
  const taskKey = search.get("task")

  const reload = useCallback(() => {
    // Everything under this project: detail, board, activity, and any open task.
    void mutate((key) => Array.isArray(key) && typeof key[0] === "string" && (key[0].includes(`/projects/${id}`) || key[0].startsWith("/api/w/tasks")))
  }, [mutate, id])

  const setTask = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(search.toString())
      if (key) params.set("task", key)
      else params.delete("task")
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
    },
    [router, pathname, search],
  )

  if (project.error) {
    return project.error instanceof ApiError && project.error.status === 404 ? (
      <NotFoundState title={t("project.notFound")} body={t("project.notFoundBody")} backHref={`/${locale}/w/${ws.slug}/projects`} backLabel={t("nav.projects")} />
    ) : (
      <ErrorState error={project.error} />
    )
  }
  if (!project.data) {
    return (
      <div className="space-y-3 px-4 pt-4 sm:px-6" data-project-loading>
        <Skeleton className="h-52 w-full rounded-card" />
        <Skeleton className="h-9 w-[28rem] max-w-full rounded-lg" />
      </div>
    )
  }
  const p = project.data
  const rest = pathname.slice(base.length)
  // An item's page (/issues/MH-3) belongs to the board: issues and cards are one thing.
  const tab = /^\/issues(\/|$)/.test(rest) ? "board" : (TABS.find((x) => rest.includes(`/${x}/`) || rest.endsWith(`/${x}`)) ?? "overview")
  // A task detail page (/projects/{id}/tasks/{key}) nests under this layout: keep the
  // project breadcrumb and context (statuses) but drop the project tabs, which don't apply.
  const isTaskRoute = pathname.includes(`/projects/${id}/tasks/`)

  return (
    <ProjectContext.Provider value={{ project: p, reload, openTask: (k) => setTask(k), base }}>
      {isTaskRoute ? (
        <div className="px-4 pt-5 sm:px-6">
          <Link href={`/${locale}/w/${ws.slug}/projects`} className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
            <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
            {t("nav.projects")}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ProjectAvatar project={p} className="size-9 text-xs" />
            <h1 className="text-h2 min-w-0 truncate text-2xl">{p.name}</h1>
            <StatusPill status={p.status} />
          </div>
        </div>
      ) : (
        <>
          <ProjectHeader p={p} base={base} slugBase={`/${locale}/w/${ws.slug}`} />
          <nav className="overflow-x-auto px-4 pt-3 pb-1 sm:px-6" aria-label={p.name} data-project-tabs>
            <Tabs value={tab} onValueChange={(v) => router.push(v === "overview" ? base : `${base}/${v}`)}>
              <TabsList variant="segmented" className="w-max">
                {TABS.filter(
                  (x) =>
                    (x !== "vault" || ws.can("vault:read")) &&
                    (x !== "github" || ws.can("integrations:read")) &&
                    (x !== "billing" || ws.can("subscriptions:manage")) &&
                    (x !== "settings" || p.can_manage),
                ).map((x) => {
                  const Icon = TAB_ICON[x]
                  return (
                    <TabsTab key={x} value={x} nativeButton={false} render={<Link href={x === "overview" ? base : `${base}/${x}`} />} data-tab={x}>
                      <Icon />
                      {t(TAB_LABEL[x])}
                    </TabsTab>
                  )
                })}
              </TabsList>
            </Tabs>
          </nav>
        </>
      )}
      {p.archived_at ? <p className="mx-4 mt-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm text-muted-foreground sm:mx-6">{t("project.archivedNotice")}</p> : null}
      {children}
      <TaskSheet taskKey={taskKey} statuses={p.statuses} onClose={() => setTask(null)} onOpen={(k) => setTask(k)} onChanged={reload} />
    </ProjectContext.Provider>
  )
}

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <ProjectShell>{children}</ProjectShell>
    </Suspense>
  )
}
