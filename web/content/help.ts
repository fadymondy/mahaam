// The public Support and Delete-your-account pages, in English and Arabic. The App Store and
// Google Play both need them at a URL that works without signing in (Play in particular wants
// account deletion explained outside the app). Like web/content/legal.ts, the words live in
// web/lang/help.{en,ar}.json (flat keys: help.<doc>.<section>.heading / .body, the body in
// Markdown) and this file only says which sections exist and in what order; the two files are
// imported here, not merged into lib/i18n.tsx, so the long text ships only with these pages.
//
// The delete page restates the Privacy Policy's "Deleting your account" section
// (legal.privacy.deletion in web/lang/legal.*.json). When that changes, this changes with it.

import en from "@/lang/help.en.json"
import ar from "@/lang/help.ar.json"

/** Where people write for help. Config first; the default is the address the legal text names. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "info@3x1.io"
/** The developer as named on the store listings (Google Play asks the deletion page to name it). */
export const DEVELOPER_NAME = process.env.NEXT_PUBLIC_DEVELOPER_NAME || "Fady Mondy"

export type HelpDoc = "support" | "delete"
export const HELP_DOCS: HelpDoc[] = ["support", "delete"]

/** The public path of each page, without the locale. */
export const HELP_PATHS: Record<HelpDoc, string> = { support: "/support", delete: "/delete-account" }

/** Section ids per page, in reading order. Each needs a .heading and a .body key in both files. */
export const HELP_SECTIONS: Record<HelpDoc, readonly string[]> = {
  support: ["about", "contact", "signin", "twofactor", "join", "language", "notifications", "delete", "apps", "legal"],
  delete: ["app", "inapp", "web", "owners", "after", "kept", "nosignin"],
}

export type HelpSection = { id: string; heading: string; body: string }
export type HelpText = { title: string; summary: string; sections: HelpSection[] }

const DICTIONARIES: Record<"en" | "ar", Record<string, string>> = { en, ar }

/**
 * The page in the page's language; a key missing in Arabic falls back to English. {email},
 * {developer} and {locale} in the text are filled in here, so the address and the links follow
 * config and the page's language instead of being written into every string.
 */
export function helpText(doc: HelpDoc, locale: string): HelpText {
  const lang = locale === "ar" ? "ar" : "en"
  const dict = DICTIONARIES[lang]
  const vars: Record<string, string> = { email: SUPPORT_EMAIL, developer: DEVELOPER_NAME, locale: lang }
  const get = (key: string) =>
    (dict[key] ?? DICTIONARIES.en[key] ?? key).replace(/\{(email|developer|locale)\}/g, (_, k: string) => vars[k])
  return {
    title: get(`help.${doc}.title`),
    summary: get(`help.${doc}.summary`),
    sections: HELP_SECTIONS[doc].map((id) => ({
      id,
      heading: get(`help.${doc}.${id}.heading`),
      body: get(`help.${doc}.${id}.body`),
    })),
  }
}
