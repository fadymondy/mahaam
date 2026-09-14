"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { CubeMark } from "@/components/brand/cube-mark"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { MANAGY_MARK } from "@/lib/brand/mark"
import { useTranslations } from "@/lib/i18n"

/** The public (signed-out / pre-workspace) frame: a centred grid column bounded by hairlines. */
export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { locale } = useTranslations()
  return (
    <div className="min-h-dvh">
      <div className={`grid-column flex min-h-dvh flex-col ${wide ? "" : "max-w-[560px]"}`}>
        <header className="flex h-14 items-center justify-between gap-2 border-b border-line px-5">
          <Link href={`/${locale}`} className="flex items-center gap-2.5">
            <CubeMark mark={MANAGY_MARK} size={26} />
            <span className="text-[15px] font-medium" dir="ltr">
              Managy
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <div className="grid-separator-contained hatch-band" aria-hidden />
        <main className="flex-1">{children}</main>
        <div className="grid-separator-contained hatch-band" aria-hidden />
      </div>
    </div>
  )
}

/** A section heading row: title, optional description, optional action. */
export function SectionHeader({
  title,
  description,
  action,
  micro,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  micro?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-6">
      <div className="min-w-0 space-y-1.5">
        {micro ? <p className="grid-micro">{micro}</p> : null}
        <h1 className="grid-title text-2xl">{title}</h1>
        {description ? <p className="grid-body max-w-2xl text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
