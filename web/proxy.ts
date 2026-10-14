import { NextResponse, type NextRequest } from "next/server"

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "@/lib/i18n-locale"

// Set by the togo auth plugin on login/register (HttpOnly).
const SESSION_COOKIE = "togo_session"

// Locale-stripped prefixes that need a session. The API is the security boundary; this file only
// decides where to SEND someone. A missing cookie goes straight to login; a present-but-invalid
// cookie is caught client-side when /api/auth/me answers 401.
const PROTECTED_PREFIXES = ["/workspaces", "/w", "/admin", "/oauth", "/app-signin"]

// Pages anyone can open signed out, listed so that a new protected prefix can't swallow them by
// accident. The store listings and the in-app browser link to them: the App Store and Google
// Play need the support and account-deletion pages to work without an account.
const PUBLIC_PAGES = ["/login", "/register", "/forgot-password", "/invite", "/legal", "/support", "/delete-account"]

function under(rest: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => rest === p || rest.startsWith(p + "/"))
}

function isProtected(rest: string): boolean {
  return !under(rest, PUBLIC_PAGES) && under(rest, PROTECTED_PREFIXES)
}

function splitLocale(pathname: string): { locale: Locale | null; rest: string } {
  const [, maybe, ...tail] = pathname.split("/")
  if (isLocale(maybe)) return { locale: maybe, rest: "/" + tail.join("/") }
  return { locale: null, rest: pathname }
}

function shouldSkip(pathname: string): boolean {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/graphql") ||
    // The CircleXO sign-in round trip is served by the API, not by a locale page.
    pathname.startsWith("/auth/circlexo") ||
    pathname === "/sso/circlexo" ||
    // So is the Hosbah OAuth callback (next.config rewrites it to the API); a locale prefix 404s it.
    pathname === "/integrations/hosbah/callback" ||
    // OAuth discovery metadata (RFC 8414/9728) must be reachable at these exact, unprefixed
    // paths — that's where a client looks for them, not under a locale.
    pathname.startsWith("/.well-known/") ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  )
}

function preferredLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value
  if (isLocale(cookie)) return cookie
  return localeFromAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE
}

// The last workspace opened, so the app starts on its home instead of the workspace list.
// A stale slug (no longer a member) lands on the workspace not-found page, which links back.
const LAST_WS_COOKIE = "mahaam_ws"

function startPath(request: NextRequest, locale: string, signedIn: boolean): string {
  if (!signedIn) return `/${locale}/login`
  const slug = request.cookies.get(LAST_WS_COOKIE)?.value
  return slug && /^[a-z0-9-]+$/i.test(slug) ? `/${locale}/w/${slug}` : `/${locale}/workspaces`
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (shouldSkip(pathname)) return NextResponse.next()

  const { locale, rest } = splitLocale(pathname)
  const signedIn = request.cookies.has(SESSION_COOKIE)

  // No locale in the URL: remembered language, then Accept-Language, then English.
  if (!locale) {
    const url = request.nextUrl.clone()
    const target = preferredLocale(request)
    url.pathname = pathname === "/" ? startPath(request, target, signedIn) : `/${target}${pathname}`
    return NextResponse.redirect(url)
  }

  const restPath = rest === "" ? "/" : rest.replace(/\/$/, "") || "/"

  if (restPath === "/") {
    const url = request.nextUrl.clone()
    url.pathname = startPath(request, locale, signedIn)
    return NextResponse.redirect(url)
  }

  if (isProtected(restPath) && !signedIn) {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.search = ""
    url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }

  // The root layout cannot read route params, so it reads the locale from here.
  const headers = new Headers(request.headers)
  headers.set("x-locale", locale)
  const response = NextResponse.next({ request: { headers } })
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" })
  }
  const ws = /^\/w\/([^/]+)/.exec(restPath)?.[1]
  if (ws && request.cookies.get(LAST_WS_COOKIE)?.value !== ws) {
    response.cookies.set(LAST_WS_COOKIE, ws, { path: "/", maxAge: 31536000, sameSite: "lax" })
  }
  return response
}

export const config = {
  matcher: "/:path*",
}
