// The language picker: a list (never a two-way toggle — more languages are coming), each language in
// its own script and direction, with its English name beside it when that differs.
import { CheckIcon, ChevronDownIcon, LanguagesIcon } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { LOCALES, useI18n } from "@/lib/i18n";

export function LanguageMenu() {
  const { t, locale } = useI18n();
  const { setPrefs } = useApp();
  const cur = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("settings.language")}
            className="inline-flex h-8 min-w-40 items-center gap-2 rounded-md border border-line bg-background px-2.5 text-[13.5px] text-grid-fg hover:bg-grid-soft"
            data-language-menu
          />
        }
      >
        <LanguagesIcon className="size-4 text-grid-muted" />
        <span className="flex-1 text-start" lang={cur.code} dir={cur.dir}>
          {cur.native}
        </span>
        <ChevronDownIcon className="size-3.5 text-grid-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {LOCALES.map((l) => (
            <DropdownMenuItem key={l.code} onClick={() => void setPrefs({ locale: l.code })} className="gap-2 text-[13.5px]" data-value={l.code}>
              <span className="flex-1" lang={l.code} dir={l.dir}>
                {l.native}
              </span>
              {l.native !== l.english ? <span className="text-[12px] text-grid-muted">{l.english}</span> : null}
              <CheckIcon className={l.code === locale ? "size-3.5" : "size-3.5 opacity-0"} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
