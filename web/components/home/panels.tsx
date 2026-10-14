"use client"

// Building blocks of the home dashboard. One grid rhythm: gap-4 between cards, p-4 inside panels,
// panels in a row share a height (grid items stretch, content flexes), every header is h-12.
import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function Panel({
  title,
  action,
  children,
  className,
  ...rest
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)} {...rest}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h2 className="truncate text-label font-semibold">{title}</h2>
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </section>
  )
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
      {children}
      <ArrowUpRightIcon className="size-3 rtl:-scale-x-100" />
    </Link>
  )
}

export function StatTile({
  icon,
  label,
  value,
  sub,
  href,
  tone,
  className,
  ...rest
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  sub: string
  href?: string
  tone?: "danger"
  className?: string
} & Record<`data-${string}`, string | undefined>) {
  const inner = (
    <>
      <span
        className={cn(
          "hidden size-10 shrink-0 items-center sm:flex justify-center rounded-md [&_svg]:size-5",
          tone === "danger" ? "bg-nq-danger-soft text-nq-danger-text" : "bg-muted text-foreground",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-caption text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</span>
        <span className="truncate text-caption text-muted-foreground">{sub}</span>
      </span>
    </>
  )
  const cls = cn("flex h-full min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-4", href && "transition-colors hover:bg-muted/50", className)
  return href ? (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  ) : (
    <div className={cls} {...rest}>
      {inner}
    </div>
  )
}
