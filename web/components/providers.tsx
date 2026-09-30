"use client"

import { useEffect, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { NasaqProvider, Toaster } from "@fadymondy/nasaq/web"

import { I18nProvider } from "@/lib/i18n"
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, isLocale } from "@/lib/i18n-locale"
import { installDiagnostics } from "@/lib/feedback/core"

const LOCALE_OPTIONS = LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l], dir: l === "ar" ? ("rtl" as const) : ("ltr" as const) }))

export function Providers({ locale, children }: { locale: string; children: ReactNode }) {
  const pathname = usePathname()

  // The feedback SDK's console/network recorder only covers what happens after it is installed,
  // so it runs in the root provider's first effect.
  useEffect(() => {
    installDiagnostics()
  }, [])

  // The locale lives in the URL: choosing a language rewrites the /en|/ar prefix and does a full
  // navigation because the root layout sets <html lang dir> on the server.
  function switchLocale(next: string) {
    if (!isLocale(next) || next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    const parts = pathname.split("/")
    if (isLocale(parts[1])) parts[1] = next
    else parts.splice(1, 0, next)
    window.location.assign(parts.join("/") + window.location.search)
  }

  return (
    <NasaqProvider brand="mahaam" defaultTheme="system" locale={locale} onLocaleChange={switchLocale} locales={LOCALE_OPTIONS} density="compact">
      <I18nProvider locale={locale}>
        {children}
        <Toaster />
      </I18nProvider>
    </NasaqProvider>
  )
}
