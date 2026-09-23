// DRAFT — THE OWNER MUST REVIEW THIS TEXT BEFORE LAUNCH. It is a plain-language draft, not legal
// advice: no legal entity, governing law or jurisdiction is named yet. Until the owner has read and
// approved it, LEGAL_REVIEWED stays false and every legal page shows a "draft" notice at the top.
//
// The public Terms of Service and Privacy Policy (MH-345), in English and Arabic. The words live in
// web/lang/legal.{en,ar}.json (flat keys: legal.<doc>.<section>.heading / .body, the body in
// Markdown); this file only says which sections exist and in what order. The two files are imported
// here rather than merged into the app-wide dictionaries in lib/i18n.tsx, so the long legal text is
// only shipped with the legal pages.
//
// Written against what the code does. When behaviour changes (a new integration, analytics, a new
// client app), the text changes in the same commit, the same rule as apps/extension/store/PRIVACY.md,
// which the privacy page's extension paragraph agrees with.

import en from "@/lang/legal.en.json"
import ar from "@/lang/legal.ar.json"

export const LEGAL_UPDATED = "2026-09-23"
export const LEGAL_REVIEWED = false

export type LegalDoc = "terms" | "privacy"
export const LEGAL_DOCS: LegalDoc[] = ["terms", "privacy"]

/** Section ids per document, in reading order. Each needs a .heading and a .body key in both files. */
export const LEGAL_SECTIONS: Record<LegalDoc, readonly string[]> = {
  terms: [
    "agreement",
    "accounts",
    "workspaces",
    "content",
    "use",
    "plans",
    "availability",
    "thirdparty",
    "termination",
    "disclaimers",
    "liability",
    "changes",
    "contact",
  ],
  privacy: [
    "short",
    "who",
    "account",
    "work",
    "time",
    "apps",
    "push",
    "biometric",
    "reports",
    "integrations",
    "security",
    "analytics",
    "cookies",
    "processors",
    "retention",
    "deletion",
    "rights",
    "children",
    "changes",
    "contact",
  ],
}

export type LegalSection = { id: string; heading: string; body: string }
export type LegalText = { title: string; summary: string; sections: LegalSection[] }

const DICTIONARIES: Record<"en" | "ar", Record<string, string>> = { en, ar }

/** The document in the page's language; a key missing in Arabic falls back to English. */
export function legalText(doc: LegalDoc, locale: string): LegalText {
  const dict = DICTIONARIES[locale === "ar" ? "ar" : "en"]
  const get = (key: string) => dict[key] ?? DICTIONARIES.en[key] ?? key
  return {
    title: get(`legal.${doc}.title`),
    summary: get(`legal.${doc}.summary`),
    sections: LEGAL_SECTIONS[doc].map((id) => ({
      id,
      heading: get(`legal.${doc}.${id}.heading`),
      body: get(`legal.${doc}.${id}.body`),
    })),
  }
}
