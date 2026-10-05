"use client"

import { Skeleton } from "@fadymondy/nasaq/web"

import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/*
  The project pages while they load: each tab outlines its own layout in place (cover and header,
  board columns, overview cards, lists), shimmering through the [data-shimmer] sweep in globals.css.
*/

export type ProjectSkeletonTab = "overview" | "board" | "github" | "vault" | "billing" | "settings"

function Busy({ className, children, ...props }: React.ComponentProps<"div">) {
  const { t } = useTranslations()
  return (
    <div aria-busy data-shimmer className={className} {...props}>
      <span className="sr-only">{t("common.loading")}</span>
      {children}
    </div>
  )
}

/** The project header: cover, avatar, name and actions, the fact chips and the tab strip. */
export function ProjectHeaderSkeleton() {
  return (
    <Busy className="border-b border-border bg-card md:-mx-page" data-project-loading>
      <Skeleton className="h-28 w-full rounded-none sm:h-36" />
      <div className="px-4 sm:px-6">
        <div className="-mt-9 flex flex-wrap items-end gap-x-4 gap-y-3 sm:-mt-11">
          <Skeleton className="relative size-18 rounded-xl ring-4 ring-card sm:size-22" />
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2 pb-1">
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-3 h-4 w-[28rem] max-w-full" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="ms-auto h-4 w-24" />
        </div>
        <div className="mt-4 flex gap-1 pb-2">
          {[24, 20, 20, 16, 20].map((w, i) => (
            <Skeleton key={i} className="h-8 rounded-md" style={{ width: `${w * 0.25}rem` }} />
          ))}
        </div>
      </div>
    </Busy>
  )
}

/** The board's status columns of cards (under the real toolbar while the issues load). */
export function BoardColumnsSkeleton() {
  return (
    <Busy className="flex gap-3 overflow-hidden pt-3 pb-2">
        {[4, 3, 2, 3].map((cards, i) => (
          <div key={i} className="flex h-[calc(100dvh-16rem)] min-h-96 w-80 shrink-0 flex-col overflow-hidden rounded-card bg-muted/40">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6 rounded-full" />
            </div>
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: cards }, (_, j) => (
                <div key={j} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-3/5" />
                  <div className="mt-1 flex items-center gap-2">
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="ms-auto size-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </Busy>
  )
}

/** The issues board: the toolbar, then the status columns. */
export function BoardSkeleton() {
  return (
    <div className="flex flex-col p-4 sm:p-6" data-shimmer>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-48 flex-1 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <BoardColumnsSkeleton />
    </div>
  )
}

function CardOutline({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-5", className)}>
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i % 2 ? "w-3/4" : "w-full")} />
      ))}
    </div>
  )
}

/** The overview: metric tiles, then the health / progress / budget cards and the activity column. */
export function OverviewSkeleton() {
  return (
    <Busy className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <CardOutline rows={3} />
      <CardOutline rows={3} />
      <CardOutline rows={3} />
      <div className="grid content-start gap-4 lg:col-span-2">
        <CardOutline rows={6} />
      </div>
      <div className="grid content-start gap-4">
        <CardOutline rows={4} />
      </div>
    </Busy>
  )
}

/** A list of rows in a card (billing subscriptions, settings sections). */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Busy className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </Busy>
  )
}

/** A grid of cards (the vault). */
export function CardGridSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Busy className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: cards }, (_, i) => (
        <CardOutline key={i} rows={2} />
      ))}
    </Busy>
  )
}

/** The GitHub tab: the repository bar and its panel. */
export function GithubSkeleton() {
  return (
    <Busy className="flex flex-col gap-3">
      <Skeleton className="h-10 w-72 max-w-full" />
      <Skeleton className="h-96 w-full rounded-card" />
    </Busy>
  )
}

/** A tab's whole body, for the project layout while the project itself loads. */
export function ProjectTabSkeleton({ tab }: { tab: ProjectSkeletonTab }) {
  if (tab === "board") return <BoardSkeleton />
  if (tab === "overview") return <OverviewSkeleton />
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6" data-shimmer>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      {tab === "vault" ? <CardGridSkeleton /> : tab === "github" ? <GithubSkeleton /> : <RowsSkeleton rows={4} />}
    </div>
  )
}
