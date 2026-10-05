"use client"

import type { ReactNode } from "react"
import { AuthEmblem, AuthFooter, AuthLayout, ProductLogo, ProductMark } from "@fadymondy/nasaq/web"

import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { brandName } from "@/lib/brand-name"
import { useTranslations } from "@/lib/i18n"

/*
  The signed-out frame: Nasaq AuthLayout (main landmark, mark, h1, footer) with the legal links and
  the language/theme controls in the footer. `wide` widens the column for reading pages (legal,
  workspace picker). `split` is the sign-in look: the brand panel on the inline start (the Mahaam
  logo), the form on the other side under the animated emblem (the mark turns into a lock and
  scans while a sign-in request runs), and `prompt` under the form ("No account? Create one").
*/
export function PublicFrame({
  eyebrow,
  title,
  description,
  wide,
  split,
  prompt,
  children,
}: {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  wide?: boolean
  split?: boolean
  prompt?: ReactNode
  children: ReactNode
}) {
  const { t, locale } = useTranslations()
  return (
    <AuthLayout
      variant={split ? "split" : "card"}
      className={wide ? "[&>main]:max-w-3xl [&>div:last-child]:max-w-3xl" : undefined}
      mark={
        split ? (
          <AuthEmblem size={104}>
            <ProductMark brand="mahaam" size={31} title="" />
          </AuthEmblem>
        ) : (
          <ProductMark brand="mahaam" size={32} title={brandName(locale)} />
        )
      }
      logo={<ProductLogo brand="mahaam" size={56} />}
      prompt={prompt}
      title={title}
      description={description}
      footer={
        <AuthFooter
          links={[
            { label: t("legal.terms"), href: `/${locale}/legal/terms` },
            { label: t("legal.privacy"), href: `/${locale}/legal/privacy` },
          ]}
          end={
            <>
              <LanguageSwitcher />
              <ThemeToggle />
            </>
          }
        />
      }
    >
      {eyebrow ? <p className="text-eyebrow uppercase text-muted-foreground">{eyebrow}</p> : null}
      {children}
    </AuthLayout>
  )
}

/** The content block of a public page (spacing only; the surface is the AuthLayout card). */
export function PublicPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>
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
