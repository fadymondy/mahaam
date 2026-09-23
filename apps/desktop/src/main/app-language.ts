// The macOS native UI language and direction: the menu bar, the tray and context menus, dialogs
// and the traffic lights (top-right in Arabic), after Zekra's app-language.ts.
//
// AppKit fixes a process's language and layout direction at launch, from the app's preferred
// localization; Electron cannot flip an NSMenu or the window buttons to RTL at runtime. So the app's
// own `AppleLanguages` default (its defaults domain only, never the system's) mirrors the Mahaam
// language, and the app relaunches when that default had to change. Electron ships ar.lproj and
// en.lproj, so AppKit honours both.
import { app, systemPreferences } from "electron";

import { LOCALES } from "../shared/locales";

/** Passed on the one automatic relaunch, so a default that does not stick can never loop. */
const RELAUNCH_FLAG = "--mahaam-language-applied";
/** The e2e flips languages many times in one run and drives one process: no relaunches there. */
const OFF = process.platform !== "darwin" || process.env.MAHAAM_E2E === "1";

let launchedRtl: boolean | null = null;

function currentAppLanguage(): string {
  const langs = systemPreferences.getUserDefault("AppleLanguages", "array") as unknown;
  return Array.isArray(langs) && typeof langs[0] === "string" ? langs[0] : "";
}

const isRtl = (code: string) => LOCALES.find((l) => l.code === code.toLowerCase().split(/[-_]/)[0])?.dir === "rtl";

/** Whether AppKit laid this process out right-to-left (fixed at launch): where the traffic lights are. */
export function nativeRtl(): boolean {
  if (OFF) return false;
  if (launchedRtl === null) launchedRtl = isRtl(currentAppLanguage());
  return launchedRtl;
}

/** Point this app's AppKit language at `locale`. True if it changed. */
function writeAppLanguage(locale: string): boolean {
  if (OFF || currentAppLanguage().toLowerCase().split(/[-_]/)[0] === locale) return false;
  systemPreferences.setUserDefault("AppleLanguages", "array", [locale]);
  return true;
}

/**
 * At launch, before any window exists: if the native language does not match the app's, fix it and
 * relaunch at once (nothing is on screen yet). True when relaunching; the caller must stop.
 */
export function ensureNativeLanguageAtLaunch(locale: string): boolean {
  if (OFF) return false;
  nativeRtl();
  if (!writeAppLanguage(locale)) return false;
  if (process.argv.includes(RELAUNCH_FLAG)) return false; // tried once already
  app.relaunch({ args: [...process.argv.slice(1), RELAUNCH_FLAG] });
  app.exit(0);
  return true;
}

/**
 * The language changed in the app. When the direction changes too, relaunch so the menus and the
 * window buttons take it (the windows reopen where they were); otherwise the new default applies
 * from the next launch and nothing blinks.
 */
export function nativeLanguageChanged(locale: string): void {
  if (OFF) return;
  const flips = isRtl(locale) !== nativeRtl();
  if (!writeAppLanguage(locale) || !flips) return;
  // Let the prefs write and the renderer's re-render land first.
  setTimeout(() => {
    app.relaunch();
    app.quit();
  }, 400);
}
