// The dictionaries in the grid's flat shape, and translate() for outside React (notifications,
// tests). Pure: no React, no grid runtime — only types — so a unit test can import it.
import type { Dict as GridDict, Dicts, Locale } from "@/grid";

import ar from "./ar";
import en from "./en";

function flatten(d: object, prefix = "", out: GridDict = {}): GridDict {
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "string") out[prefix + k] = v;
    else flatten(v as object, `${prefix}${k}.`, out);
  }
  return out;
}

/** Mahaam's strings in the grid's shape, for <StringsProvider strings={strings}>. */
export const strings: Dicts = { en: flatten(en), ar: flatten(ar) };

/** Fills every {var} (the grid's own t() fills each one once). */
export const fill = (s: string, vars?: Record<string, string | number>) => {
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

/** A key in a given language, English as the fallback. */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return fill(strings[locale][key] ?? strings.en[key] ?? key, vars);
}
