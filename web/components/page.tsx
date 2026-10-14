"use client"

import type { ComponentProps, ReactNode } from "react"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@fadymondy/nasaq/web"

import { cn } from "@/lib/utils"

/*
The Nasaq page frame for the workspace pages. The shell's AppMain is p-0, so a page brings its own
inset: Page centres the content (max-w-6xl) with the standard padding, PageHeader (Nasaq) titles it,
and each block of content sits in a Panel: a Nasaq Card with an optional title / description /
actions header. A `flush` Panel drops the inner padding so a Table or a divided list runs edge to
edge inside the card.
*/

export { PageHeader }

export function Page({ className, wide, ...props }: ComponentProps<"div"> & { wide?: boolean }) {
  return <div className={cn("mx-auto flex w-full flex-col gap-6 p-4 sm:p-6", wide ? "max-w-7xl" : "max-w-6xl", className)} {...props} />
}

export function Panel({
  title,
  description,
  actions,
  flush,
  className,
  contentClassName,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** No inner padding: for a Table or a divided list that runs to the card's edges. */
  flush?: boolean
  contentClassName?: string
}) {
  const head = title || description || actions
  return (
    <Card className={cn("min-w-0 gap-0 overflow-hidden", flush ? "py-0" : "gap-4", className)} {...props}>
      {head ? (
        <CardHeader className={cn(flush && "border-b border-border py-4")}>
          {title ? <CardTitle className="text-h4">{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {actions ? <CardAction className="flex flex-wrap items-center gap-2">{actions}</CardAction> : null}
        </CardHeader>
      ) : null}
      {children != null && children !== false ? <CardContent className={cn(flush && "px-0", contentClassName)}>{children}</CardContent> : null}
    </Card>
  )
}

/** A section heading inside a page (between Panels), when the block itself isn't a card. */
export function SectionTitle({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-h3">{title}</h2>
        {description ? <p className="mt-1 text-body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
