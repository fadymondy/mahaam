"use client"

// Building blocks of the project overview: a card frame and a row-list helper.
import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function Card({
  title,
  action,
  children,
  className,
  flush = false,
  ...rest
}: {
  title: string
  /** A "view all" link in the card header. */
  action?: { href: string; label: string }
  children: ReactNode
  className?: string
  /** No body padding: lists run edge to edge. */
  flush?: boolean
} & Omit<React.ComponentProps<"section">, "title">) {
  return (
    <section className={cn("flex min-w-0 flex-col border border-border bg-card", className)} aria-label={title} {...rest}>
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {action ? (
          <Link href={action.href} className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
            {action.label}
            <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
          </Link>
        ) : null}
      </header>
      <div className={cn("min-w-0 flex-1", flush ? "" : "px-4 pb-4")}>{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

/** A label / value line, as in the Hosbah "App information" card. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-end text-foreground">{children}</dd>
    </div>
  )
}
