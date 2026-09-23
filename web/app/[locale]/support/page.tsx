import type { Metadata } from "next"

import { HelpPage } from "@/components/help/help-page"
import { helpText } from "@/content/help"
import { brandName } from "@/lib/brand-name"
import { isLocale } from "@/lib/i18n-locale"

// Public, no session: /{locale}/support, the support URL on the App Store and Google Play listings.
// proxy.ts only sends its PROTECTED_PREFIXES to sign-in, and nothing here calls the API.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const text = helpText("support", locale)
  return { title: `${text.title} · ${brandName(locale)}`, description: text.summary }
}

export default function SupportRoute() {
  return <HelpPage doc="support" />
}
