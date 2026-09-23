// The one place that decides "new iOS" (as in Zekra's src/lib/platform.ts): iOS 26+ gets the
// native Liquid Glass navigation — the system tab bar, the search tab and its bottom search field;
// older iOS and Android keep the grid's tab bar. Fixed for the process, so the navigator never
// swaps at runtime.
import { Platform } from "react-native";

export const LIQUID_GLASS_MIN_IOS = 26;

/** The major version out of Platform.Version ("27.0", "26.0.1", 26 …); 0 when unparseable. */
export function majorVersion(version: string | number | null | undefined): number {
  if (typeof version === "number") return Number.isFinite(version) && version > 0 ? Math.floor(version) : 0;
  if (typeof version !== "string") return 0;
  const m = /^\s*(\d+)/.exec(version);
  return m ? Number(m[1]) : 0;
}

/** True on iOS 26+ only — Android API levels never count, whatever the number. */
export const isLiquidGlassOS = (os: string, version: string | number | null | undefined) =>
  os === "ios" && majorVersion(version) >= LIQUID_GLASS_MIN_IOS;

let cached: boolean | undefined;
export function isLiquidGlass(): boolean {
  if (cached === undefined) cached = isLiquidGlassOS(Platform.OS, Platform.Version);
  return cached;
}
