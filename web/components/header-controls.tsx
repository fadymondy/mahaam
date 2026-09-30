"use client"

import { LocaleSwitcher, ThemeSwitcher } from "@fadymondy/nasaq/web"

import { useTranslations } from "@/lib/i18n"

// Theme and language controls for headers outside the app shell's user menu (public pages, portal).
// The provider owns both: the theme in localStorage, the locale through the URL prefix.
export function ThemeToggle() {
  const { t } = useTranslations()
  return <ThemeSwitcher labels={{ group: t("header.toggleTheme") }} />
}

export function LanguageSwitcher() {
  const { t } = useTranslations()
  return <LocaleSwitcher label={t("header.language")} />
}
