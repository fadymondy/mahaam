import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { palettes, type Palette } from "./tokens";

export type ThemePref = "system" | "light" | "dark";
const KEY = "mahaam.theme";

interface ThemeCtx {
  c: Palette;
  scheme: "light" | "dark";
  pref: ThemePref;
  setPref(p: ThemePref): void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "system") setPrefState(v);
    });
  }, []);
  const scheme: "light" | "dark" = pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
  const value = useMemo<ThemeCtx>(
    () => ({
      c: palettes[scheme],
      scheme,
      pref,
      setPref(p) {
        setPrefState(p);
        void AsyncStorage.setItem(KEY, p);
      },
    }),
    [scheme, pref],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}
