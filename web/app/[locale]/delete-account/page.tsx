import type { Metadata } from "next"

import { HelpPage } from "@/components/help/help-page"
import { helpText } from "@/content/help"
import { brandName } from "@/lib/brand-name"
import { isLocale } from "@/lib/i18n-locale"

// Public, no session: /{locale}/delete-account. Google Play asks for an account-deletion URL that
// works outside the app, so this explains the in-app and web steps and the email fallback for
// people who can't sign in. proxy.ts only sends its PROTECTED_PREFIXES to sign-in.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const text = helpText("delete", locale)
  return { title: `${text.title} · ${brandName(locale)}`, description: text.summary }
}

export default function DeleteAccountRoute() {
  return <HelpPage doc="delete" />
}
