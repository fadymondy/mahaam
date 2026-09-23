// DRAFT — the Terms and Privacy Policy served here must be reviewed by the owner before launch
// (web/content/legal.ts, LEGAL_REVIEWED; the words are in web/lang/legal.{en,ar}.json).

import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { LegalPage } from "@/components/legal/legal-page"
import { LEGAL_DOCS, legalText, type LegalDoc } from "@/content/legal"
import { brandName } from "@/lib/brand-name"
import { isLocale } from "@/lib/i18n-locale"

// Public, no session: /{locale}/legal/terms and /{locale}/legal/privacy. proxy.ts only redirects
// its PROTECTED_PREFIXES to sign-in, and nothing here calls the API, so a signed-out visitor, a
// store reviewer or the mobile app's in-app browser can open them (MH-345).
function isDoc(v: string): v is LegalDoc {
  return (LEGAL_DOCS as string[]).includes(v)
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; doc: string }> }): Promise<Metadata> {
  const { locale, doc } = await params
  if (!isLocale(locale) || !isDoc(doc)) return {}
  const text = legalText(doc, locale)
  // Server-rendered, unlike the app's client-side titles: a public page is read by search engines
  // and store reviewers, not only by a signed-in browser.
  return { title: `${text.title} · ${brandName(locale)}`, description: text.summary }
}

export default async function LegalRoute({ params }: { params: Promise<{ locale: string; doc: string }> }) {
  const { doc } = await params
  if (!isDoc(doc)) notFound()
  return <LegalPage doc={doc} />
}
