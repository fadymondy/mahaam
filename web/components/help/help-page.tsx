"use client"

import Link from "next/link"

import { Markdown } from "@/components/markdown"
import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { HELP_DOCS, HELP_PATHS, helpText, type HelpDoc } from "@/content/help"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

// Short names for the page switcher; the same keys label the public footer's links.
const NAV_LABEL: Record<HelpDoc, string> = { support: "footer.support", delete: "footer.deleteAccount" }

// The Support and Delete-your-account pages on the signed-out frame, laid out like the legal
// pages (components/legal/legal-page.tsx): the other page one click away, then one anchored
// section per heading in a readable column. The words are in web/lang/help.{en,ar}.json.
export function HelpPage({ doc }: { doc: HelpDoc }) {
  const { t, locale } = useTranslations()
  const text = helpText(doc, locale)
  useDocumentTitle(text.title)

  return (
    <PublicFrame eyebrow={t("help.eyebrow")} title={text.title} description={text.summary}>
      <PublicPanel className="px-4 py-8 sm:px-8">
        <nav className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label={t("help.eyebrow")}>
          {HELP_DOCS.map((d) => (
            <Link
              key={d}
              href={`/${locale}${HELP_PATHS[d]}`}
              aria-current={d === doc ? "page" : undefined}
              className={cn(
                "underline-offset-4",
                d === doc ? "font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg hover:underline",
              )}
            >
              {t(NAV_LABEL[d])}
            </Link>
          ))}
        </nav>
        <article className="max-w-[68ch] text-[15px] leading-relaxed" data-help-doc={doc}>
          {text.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="mt-8 scroll-mt-20 first:mt-0">
              <h2 id={`${s.id}-heading`} className="mb-2 text-base font-semibold text-grid-fg">
                <a href={`#${s.id}`} className="underline-offset-4 hover:underline">
                  {s.heading}
                </a>
              </h2>
              <Markdown trusted className="text-[15px]">
                {s.body}
              </Markdown>
            </section>
          ))}
        </article>
      </PublicPanel>
    </PublicFrame>
  )
}
