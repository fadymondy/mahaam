"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"

/**
 * Client-side guard: a session cookie that the API rejects (401) sends the visitor to login and
 * back here afterwards. proxy.ts already redirects when there is no cookie at all.
 */
export function useRequireAuth() {
  const me = useMe()
  const router = useRouter()
  const pathname = usePathname()
  const { locale } = useTranslations()

  useEffect(() => {
    if (me.data === null) {
      const next = pathname + window.location.search
      router.replace(`/${locale}/login?next=${encodeURIComponent(next)}`)
    }
  }, [me.data, pathname, locale, router])

  return me
}

/**
 * Only same-app relative paths are honoured as a post-login destination: one leading "/", never
 * "//host" or "/\host", and no backslash, whitespace or control character a browser might
 * normalise into something else. The same rule as the API's safeNext (internal/server/oauth_return.go).
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || next.length > 2048 || !next.startsWith("/") || next.startsWith("//")) return fallback
  if (/[\\\s\u0000-\u001f\u007f-\u009f]/.test(next)) return fallback
  return next
}
