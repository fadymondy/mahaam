"use client"

import type { ReactNode } from "react"
import { FingerprintIcon, HistoryIcon, LayersIcon, ShieldCheckIcon } from "lucide-react"
import { AuthEmblem, AuthFooter, AuthLayout, AuthOrigin, LocaleSwitcher, ProductLogo, ProductMark, ThemeToggle } from "@fadymondy/nasaq/web"

import { brandName } from "@/lib/brand-name"
import { useTranslations } from "@/lib/i18n"

/*
  The signed-out frame: Nasaq AuthLayout (main landmark, mark, h1, footer) with the legal links and
  the language/theme controls in the footer. `wide` widens the column for reading pages (legal,
  workspace picker). `split` is the sign-in look: the brand panel on the inline start (the Mahaam
  logo), the form on the other side under the animated emblem (the mark turns into a lock and
  scans while a sign-in request runs), the address check (AuthOrigin) and `prompt` under the form
  ("No account? Create one"); the panel says what protects the account, as the CircleXO hub's does.
  The footer's theme and language switchers are the hub's too (ThemeToggle, labelled LocaleSwitcher).
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
      panel={split ? <SecurityPanel /> : undefined}
      prompt={prompt}
      title={title}
      description={description}
      footer={
        <AuthFooter
          links={[
            { label: t("legal.terms"), href: `/${locale}/legal/terms` },
            { label: t("legal.privacy"), href: `/${locale}/legal/privacy` },
            { label: t("footer.support"), href: `/${locale}/support` },
            { label: t("footer.deleteAccount"), href: `/${locale}/delete-account` },
          ]}
          end={
            <>
              <ThemeToggle />
              <LocaleSwitcher showLabel label={t("header.language")} />
            </>
          }
        />
      }
    >
      {eyebrow ? <p className="text-eyebrow uppercase text-muted-foreground">{eyebrow}</p> : null}
      {children}
      {split ? <AuthOrigin /> : null}
    </AuthLayout>
  )
}

const POINTS = [
  { key: "hub", icon: LayersIcon },
  { key: "twoStep", icon: FingerprintIcon },
  { key: "isolation", icon: ShieldCheckIcon },
  { key: "record", icon: HistoryIcon },
] as const

// The brand side of the sign-in page: what Mahaam is, and what protects the account.
function SecurityPanel() {
  const { t } = useTranslations()
  return (
    <>
      <ProductLogo brand="mahaam" size={28} />
      <div className="flex max-w-md flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-h2 text-foreground">{t("auth.panel.title")}</p>
          <p className="text-body text-muted-foreground">{t("auth.panel.body")}</p>
        </div>
        <ul className="flex flex-col gap-4">
          {POINTS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-nq-action">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-body-sm font-medium text-foreground">{t(`auth.panel.${key}`)}</p>
                <p className="text-caption text-muted-foreground">{t(`auth.panel.${key}Body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-caption text-muted-foreground">© {t("auth.panel.copyright")}</p>
    </>
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
