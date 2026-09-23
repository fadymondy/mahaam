// The language picker: a native list (never a two-way toggle — more languages are coming), each
// language in its own script, with its English name beside it when that differs.
import { ChevronDownIcon, LanguagesIcon } from "lucide-react";

import { useApp } from "@/lib/app";
import { LOCALES, useI18n } from "@/lib/i18n";
import { nativeMenu } from "@/lib/native";

export function LanguageMenu() {
  const { t, locale } = useI18n();
  const { setPrefs } = useApp();
  const cur = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]!;
  return (
    <button
      type="button"
      aria-label={t("settings.language")}
      aria-haspopup="menu"
      className="inline-flex h-8 min-w-40 items-center gap-2 rounded-md border border-line bg-background px-2.5 text-[13.5px] text-grid-fg hover:bg-grid-soft"
      data-language-menu
      onClick={(e) =>
        void nativeMenu(
          LOCALES.map((l) => ({ id: l.code, label: l.native, sublabel: l.native !== l.english ? l.english : undefined, type: "radio" as const, checked: l.code === locale })),
          e.currentTarget,
        ).then((code) => code && void setPrefs({ locale: code as typeof locale }))
      }
    >
      <LanguagesIcon className="size-4 text-grid-muted" />
      <span className="flex-1 text-start" lang={cur.code} dir={cur.dir}>
        {cur.native}
      </span>
      <ChevronDownIcon className="size-3.5 text-grid-muted" />
    </button>
  );
}
