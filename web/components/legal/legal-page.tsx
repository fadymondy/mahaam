"use client"

import Link from "next/link"

import { Markdown } from "@/components/markdown"
import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { LEGAL, LEGAL_DOCS, LEGAL_REVIEWED, LEGAL_UPDATED, type LegalDoc } from "@/content/legal"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

// The Terms and the Privacy Policy on the signed-out frame (MH-345). Readable column, the other
// document one click away, and a plain "draft" notice for as long as the owner hasn't signed the
// text off (content/legal.ts, LEGAL_REVIEWED).
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, locale, formatDate } = useTranslations()
  const text = LEGAL[doc][locale === "ar" ? "ar" : "en"]
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
                d === doc ? "font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg hover:underline",
              )}
            >
              {LEGAL[d][locale === "ar" ? "ar" : "en"].title}
            </Link>
          ))}
          <span className="grid-micro ms-auto">{t("legal.updated", { date: formatDate(LEGAL_UPDATED) })}</span>
        </nav>
        {!LEGAL_REVIEWED ? (
          <p className="mb-6 rounded-md border border-line p-3 text-sm text-grid-muted" role="note" data-legal-draft>
            {t("legal.draft")}
          </p>
        ) : null}
        <article className="max-w-[68ch] text-[15px] leading-relaxed" data-legal-doc={doc}>
          <Markdown className="text-[15px]">{text.body}</Markdown>
        </article>
      </PublicPanel>
    </PublicFrame>
  )
}
