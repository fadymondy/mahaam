// Inter for the English UI; Arabic stays in IBM Plex Sans Arabic (the grid's face for both scripts).
//
// The grid (src/grid, generated — never edited here) names its faces in one constant, `fonts`,
// read at render time everywhere. English is always left-to-right and a language switch reloads
// the app (grid prefs → forceRTL + reload), so the direction at launch says which language this
// run is in: when it is LTR, the grid's sans faces are swapped for Inter before anything renders.
// This module must be imported first by the root layout.
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { I18nManager } from "react-native";

import { fonts } from "@/grid";

export const englishUi = !I18nManager.isRTL;

if (englishUi) {
  Object.assign(fonts as Record<keyof typeof fonts, string>, {
    light: "Inter_300Light",
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
  });
}

/** True once Inter is ready (immediately in Arabic, which does not use it). */
export function useUiFonts(): boolean {
  const [loaded, error] = useFonts(englishUi ? { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } : {});
  return !englishUi || loaded || !!error;
}
