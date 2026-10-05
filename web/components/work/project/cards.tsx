"use client"

// Building blocks of the project overview: a Nasaq card with a title and "view all" link, and row helpers.
import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRightIcon } from "lucide-react"

import { CardAction, CardContent, CardHeader, CardTitle, Card as NqCard } from "@fadymondy/nasaq/web"

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
    <NqCard role="region" aria-label={title} className={cn("min-w-0 gap-3", flush && "pb-1", className)} {...(rest as React.ComponentProps<"div">)}>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        {action ? (
          <CardAction>
            <Link href={action.href} className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
              {action.label}
              <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={cn("min-w-0 flex-1", flush && "px-0")}>{children}</CardContent>
    </NqCard>
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
