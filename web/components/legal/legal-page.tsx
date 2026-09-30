"use client"

// DRAFT — the legal text this page shows must be reviewed by the owner before launch
// (web/content/legal.ts, LEGAL_REVIEWED; the words are in web/lang/legal.{en,ar}.json).

import Link from "next/link"

import { Markdown } from "@/components/markdown"
import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { LEGAL_DOCS, LEGAL_REVIEWED, LEGAL_UPDATED, legalText, type LegalDoc } from "@/content/legal"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

// The Terms and the Privacy Policy on the signed-out frame (MH-345). Readable column, the other
// document one click away, one anchored section per heading, and a plain "draft" notice for as
// long as the owner hasn't signed the text off.
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, locale, formatDate } = useTranslations()
  const text = legalText(doc, locale)
  useDocumentTitle(text.title)

  return (
    <PublicFrame eyebrow={t("legal.eyebrow")} title={text.title} description={text.summary}>
      <PublicPanel className="px-4 py-8 sm:px-8">
        <nav className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label={t("legal.eyebrow")}>
          {LEGAL_DOCS.map((d) => (
            <Link
              key={d}
              href={`/${locale}/legal/${d}`}
              aria-current={d === doc ? "page" : undefined}
              className={cn(
                "underline-offset-4",
                d === doc ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground hover:underline",
              )}
            >
              {legalText(d, locale).title}
            </Link>
          ))}
          <span className="text-eyebrow uppercase ms-auto">{t("legal.updated", { date: formatDate(LEGAL_UPDATED) })}</span>
        </nav>
        {!LEGAL_REVIEWED ? (
          <p className="mb-6 rounded-md border border-border p-3 text-sm text-muted-foreground" role="note" data-legal-draft>
            {t("legal.draft")}
          </p>
        ) : null}
        <article className="max-w-[68ch] text-[15px] leading-relaxed" data-legal-doc={doc}>
          {text.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="mt-8 scroll-mt-20 first:mt-0">
              <h2 id={`${s.id}-heading`} className="mb-2 text-base font-semibold text-foreground">
                <a href={`#${s.id}`} className="underline-offset-4 hover:underline">
                  {s.heading}
                </a>
              </h2>
              <Markdown className="text-[15px]">{s.body}</Markdown>
            </section>
          ))}
        </article>
      </PublicPanel>
    </PublicFrame>
  )
}
