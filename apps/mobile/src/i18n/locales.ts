// The languages the app offers, in the order the language list shows them. Adding a language is
// one entry here plus its dictionary (src/i18n/<code>.ts) and its name under `languages` in each
// dictionary. (The grid's Locale type names the ones its preferences can store: en and ar today.)
import type { Locale } from "@/grid";

export type LocaleOption = {
  code: Locale;
  /** The language's name in its own script: how a speaker recognises it in any UI language. */
  native: string;
  rtl: boolean;
};

export const LOCALES: readonly LocaleOption[] = [
  { code: "en", native: "English", rtl: false },
  { code: "ar", native: "العربية", rtl: true },
];
