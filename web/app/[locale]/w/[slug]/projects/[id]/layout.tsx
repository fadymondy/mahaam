"use client"

import Link from "next/link"
import { Suspense, useCallback, type ReactNode } from "react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArchiveIcon, ChevronLeftIcon } from "lucide-react"
import { useSWRConfig } from "swr"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { NotFoundState } from "@/components/not-found-state"
import { ErrorState } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { ProjectContext } from "@/components/work/project-context"
import { TaskSheet } from "@/components/work/task-sheet"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useProject } from "@/lib/work"

const TABS = ["overview", "board", "list", "issues", "github", "vault", "billing", "settings"] as const

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
      <div className="space-y-4 p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-9 w-96 max-w-full" />
      </div>
    )
  }
  const p = project.data
  const tab = TABS.find((x) => pathname.endsWith(`/${x}`)) ?? "overview"
  // A task detail page (/projects/{id}/tasks/{key}) nests under this layout: keep the
  // project breadcrumb and context (statuses) but drop the project tabs, which don't apply.
  const isTaskRoute = pathname.includes(`/projects/${id}/tasks/`)

  return (
    <ProjectContext.Provider value={{ project: p, reload, openTask: (k) => setTask(k), base }}>
      <div className="px-6 pt-5">
        <Link href={`/${locale}/w/${ws.slug}/projects`} className="inline-flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("nav.projects")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ColorDot color={p.color} className="size-3" />
          <h1 className="grid-title min-w-0 truncate text-2xl">{p.name}</h1>
          <Badge variant="outline">{t(`projectStatus.${p.status}`)}</Badge>
          {p.archived_at ? (
            <Badge variant="secondary" className="gap-1">
              <ArchiveIcon />
              {t("project.archivedBadge")}
            </Badge>
          ) : null}
          {p.client_name ? <span className="text-sm text-grid-muted">{p.client_name}</span> : null}
        </div>
      </div>
      {!isTaskRoute ? (
        <div className="mt-4 border-b border-line px-6">
          <Tabs value={tab} onValueChange={(v) => router.push(v === "overview" ? base : `${base}/${v}`)}>
            <TabsList variant="line">
              {TABS.filter((x) => (x !== "vault" || ws.can("vault:read")) && (x !== "github" || ws.can("integrations:read")) && (x !== "billing" || ws.can("subscriptions:manage"))).map((x) => (
                <TabsTrigger key={x} value={x} nativeButton={false} render={<Link href={x === "overview" ? base : `${base}/${x}`} />}>
                  {t(`projectTab.${x}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}
      {p.archived_at ? <p className="border-b border-line bg-grid-soft px-6 py-2 text-sm text-grid-muted">{t("project.archivedNotice")}</p> : null}
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
