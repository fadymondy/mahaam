// Every language the app speaks, in the order a list shows them. Adding a language is one entry
// here (plus its strings); every language picker — Settings, ⌘K, the native menu — is a list built
// from this, never a two-way toggle.
export type Locale = "en" | "ar";

export const LOCALES: { code: Locale; native: string; english: string; dir: "ltr" | "rtl" }[] = [
  { code: "en", native: "English", english: "English", dir: "ltr" },
  { code: "ar", native: "العربية", english: "Arabic", dir: "rtl" },
];
