"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ProductMark } from "@fadymondy/nasaq/web"
import { brandName } from "@/lib/brand-name"

import { cn } from "@/lib/utils"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { useTranslations } from "@/lib/i18n"
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n-locale"

/*
  The signed-out frame, copied from fadymondy.com's /en/login anatomy
  (web/app/[locale]/login/page.tsx -> PageShell + Panel + LoginForm):

    sticky full-width header: 860px column bounded by hairlines, mark + wordmark, toggles
    a 40px spacer, then the eyebrow / title / description band between full-bleed rules
    one Panel with the content centred (forms at max-w-sm, 384px)
    a filler that keeps the column rules running down to the footer
    the footer: a hatch band and a title-block row, like the reference's CAD footer

  Full-bleed rules are ::before/::after at z-index -1, so the root isolates a stacking context.
*/
export function PublicFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  const { t, locale } = useTranslations()
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-50 bg-background px-2">
        <div className="border-t border-border border-b border-border mx-auto flex h-14 max-w-[860px] items-center gap-2 border-x border-border ps-4 pe-2">
          <Link href={`/${locale}`} className="flex items-center gap-2.5" aria-label={brandName(locale)}>
            <ProductMark brand="mahaam" size={22} title="" />
            <span className="text-[15px] font-medium" dir="ltr">
              {brandName(locale)}
            </span>
          </Link>
          <div className="flex-1" />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 flex-col px-2">
        <div className="mx-auto flex w-full max-w-[860px] flex-1 flex-col">
          <div className="h-10 border-x border-border" />
          {title ? (
            <div className="border-x border-border" data-slot="page-heading">
              {eyebrow ? <div className="font-mono px-4 pb-2 text-sm/none tracking-wider text-muted-foreground">{eyebrow}</div> : null}
              <h1 className="border-t border-border border-b border-border px-4 text-3xl font-medium tracking-tight text-balance">
                {title}
              </h1>
              {description ? (
                <p className="border-b border-border p-4 text-base text-pretty text-muted-foreground">{description}</p>
              ) : null}
            </div>
          ) : null}
          {children}
          <div className="flex-1 border-x border-border" />
        </div>
      </main>

      <footer className="px-2">
        <div className="mx-auto max-w-[860px] border-x border-border">
          <div className="border-t border-border border-b border-border">
            <div className="bg-muted h-12" />
          </div>
          <div className="border-b border-border flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <span className="font-mono font-medium" dir="ltr">
              {brandName(locale)}
            </span>
            <span className="text-muted-foreground">{t("footer.tagline")}</span>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-4">
            <FooterCell label={t("footer.product")}>{t("footer.productValue")}</FooterCell>
            <FooterCell label={t("footer.craftedBy")}>
              <a className="underline-offset-4 hover:underline" href="https://fadymondy.com" dir="ltr">
                fadymondy.com
              </a>
            </FooterCell>
            <FooterCell label={t("footer.stack")}>
              <span dir="ltr">Go · Next.js</span>
            </FooterCell>
            <FooterCell label={t("footer.languages")}>
              {LOCALES.map((l, i) => (
                <span key={l}>
                  {i > 0 ? " · " : null}
                  <span lang={l}>{LOCALE_NAMES[l]}</span>
                </span>
              ))}
            </FooterCell>
          </dl>
          <div className="border-t border-border border-b border-border mt-4 flex items-center gap-4 px-4 py-3 text-sm text-muted-foreground">
            <Link href={`/${locale}`} aria-label={brandName(locale)}>
              <ProductMark brand="mahaam" size={16} title="" />
            </Link>
            <div className="flex-1" />
            <Link href={`/${locale}/legal/terms`} className="underline-offset-4 hover:text-foreground hover:underline">
              {t("legal.terms")}
            </Link>
            <Link href={`/${locale}/legal/privacy`} className="underline-offset-4 hover:text-foreground hover:underline">
              {t("legal.privacy")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FooterCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-e border-b border-border px-4 py-3 last:border-e-0 max-md:nth-[2n]:border-e-0">
      <dt className="text-eyebrow uppercase">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/** One bordered section between full-bleed rules (the reference's Panel). */
export function PublicPanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className="border-t border-border border-b border-border border-x border-border">
      <div className={cn("p-4", className)}>{children}</div>
    </section>
  )
}

/** A section heading row for signed-in pages: title, optional description, optional action. */
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
        {micro ? <p className="text-eyebrow uppercase">{micro}</p> : null}
        <h1 className="text-h2 text-2xl">{title}</h1>
        {description ? <p className="text-body text-nq-fg-body max-w-2xl text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
