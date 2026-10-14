"use client"

import { Skeleton } from "@fadymondy/nasaq/web"

import { useTranslations } from "@/lib/i18n"

/*
  The whole home page in outline while its data loads: the greeting, the five stat tiles, the
  project filters and cards, and the three panels, each in its real place and size so nothing jumps
  when the data arrives. The Skeletons shimmer ([data-shimmer], app/globals.css).
*/
export function DashboardSkeleton({ panels }: { panels: number }) {
  const { t } = useTranslations()
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6 px-4 py-6 sm:px-6" data-home data-shimmer aria-busy="true">
      <span className="sr-only" role="status">
        {t("common.loading")}
      </span>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`flex items-center gap-3 rounded-lg border border-border bg-card p-4 ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`}>
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-3 w-24 max-w-full" />
            </div>
          </div>
        ))}
      </div>

      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-9 w-56 rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <div className="flex items-center justify-between">
                <div className="flex -space-x-2 rtl:space-x-reverse">
                  {Array.from({ length: 3 }, (_, j) => (
                    <Skeleton key={j} className="size-6 rounded-full ring-2 ring-card" />
                  ))}
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: panels }, (_, i) => (
          <div key={i} className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
            <div className="flex h-12 items-center justify-between gap-3 border-b border-border px-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="flex flex-col gap-4 p-4">
              {Array.from({ length: 5 }, (_, j) => (
                <div key={j} className="flex items-center gap-3">
                  <Skeleton className="size-7 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
