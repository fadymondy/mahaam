import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { LegalPage } from "@/components/legal/legal-page"
import { LEGAL, LEGAL_DOCS, type LegalDoc } from "@/content/legal"
import { brandName } from "@/lib/brand-name"
import { isLocale } from "@/lib/i18n-locale"

// Public, no session: the store listings and the register screens link here (MH-345).
function isDoc(v: string): v is LegalDoc {
  return (LEGAL_DOCS as string[]).includes(v)
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; doc: string }> }): Promise<Metadata> {
  const { locale, doc } = await params
  if (!isLocale(locale) || !isDoc(doc)) return {}
  const text = LEGAL[doc][locale === "ar" ? "ar" : "en"]
  // Server-rendered, unlike the app's client-side titles: a public page is read by search engines
  // and store reviewers, not only by a signed-in browser.
  return { title: `${text.title} · ${brandName(locale)}`, description: text.summary }
}

export default async function LegalRoute({ params }: { params: Promise<{ locale: string; doc: string }> }) {
  const { doc } = await params
  if (!isDoc(doc)) notFound()
  return <LegalPage doc={doc} />
}
