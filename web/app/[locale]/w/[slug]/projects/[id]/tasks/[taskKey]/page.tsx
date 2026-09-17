"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { ErrorState } from "@/components/states"
import { NotFoundState } from "@/components/not-found-state"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskBody } from "@/components/work/task-sheet"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { useTask } from "@/lib/work"

/**
 * A shareable full page for one task: the same editors as the board side-over, on their own
 * URL (?task= side-over links here). Renders inside the project layout (breadcrumb + statuses
 * come from the project context); the tabs are hidden for this sub-route.
 */
export default function TaskDetailPage() {
  const { taskKey } = useParams<{ taskKey: string }>()
  const { t, isRtl } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const { project, base, reload } = useProjectCtx()
  const task = useTask(ws.id, taskKey)
  const d = task.data
  useDocumentTitle(d ? `${d.key} · ${d.title}` : `${taskKey} · ${project.name}`)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={`${base}/board`}
        className="inline-flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg"
      >
        <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
        {t("projectTab.board")}
      </Link>

      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-grid-bg">
        {task.error ? (
          task.error instanceof ApiError && task.error.status === 404 ? (
            <NotFoundState
              title={t("task.notFound")}
              body={t("task.notFoundBody")}
              backHref={`${base}/board`}
              backLabel={t("projectTab.board")}
            />
          ) : (
            <div className="p-6">
              <ErrorState error={task.error} />
            </div>
          )
        ) : !d ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <TaskBody
            key={d.id}
            d={d}
            chrome="page"
            statuses={project.statuses}
            onOpen={(key) => router.push(`${base}/tasks/${key}`)}
            onChanged={() => {
              void task.mutate()
              reload()
            }}
            onDeleted={() => {
              reload()
              router.push(`${base}/board`)
            }}
          />
        )}
      </div>
    </div>
  )
}
