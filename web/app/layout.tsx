import { headers } from "next/headers"
import type { Metadata, Viewport } from "next"

import "./globals.css"
import { Providers } from "@/components/providers"
import { PwaRegister } from "@/components/pwa-register"
import { brandName } from "@/lib/brand-name"
import { dirForLocale, isLocale, type Locale } from "@/lib/i18n-locale"

// The product name in the page's language (مهام on /ar); proxy.ts forwards the locale on x-locale.
export async function generateMetadata(): Promise<Metadata> {
  const raw = (await headers()).get("x-locale")
  const ar = raw === "ar"
  return {
    title: brandName(raw),
    applicationName: brandName(raw),
    description: ar ? "إدارة المشاريع وتتبّع الوقت." : "Project management and time tracking.",
    // The console is behind a login: the product home (mahaam.app) is what search engines index.
    robots: { index: false, follow: false },
    // Installed on iOS: full-screen, with the brand name under the home-screen icon.
    appleWebApp: { capable: true, title: brandName(raw), statusBarStyle: "default" },
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
  viewportFit: "cover",
}

// The locale lives in the URL (/en/..., /ar/...). A root layout cannot read route params, so
// proxy.ts resolves it and forwards it on x-locale.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const raw = h.get("x-locale")
  const locale: Locale = isLocale(raw) ? raw : "en"
  // The desktop app (apps/desktop) says so in its user agent, so its window chrome (room for the
  // traffic lights, drag regions) is right on the first paint rather than after hydration.
  const desktop = /MahaamDesktop\/\S+ \((darwin|win32|linux)\)/.exec(h.get("user-agent") ?? "")?.[1]

  return (
    <html
      lang={locale}
      dir={dirForLocale(locale)}
      data-brand="mahaam"
      data-desktop={desktop}
      className="grid-surface"
      suppressHydrationWarning
    >
      <body className="min-h-dvh" suppressHydrationWarning>
        <Providers locale={locale}>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  )
}
