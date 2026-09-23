import AsyncStorage from "@react-native-async-storage/async-storage";
import { focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
import { AppState, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { dirStyle, PrefsProvider, StringsProvider, useGridReady, useNavTheme, usePrefs } from "@/grid";
import { APP } from "@/grid.config";
import { strings } from "@/i18n";
import { persister, queryClient } from "@/lib/query";
import { SessionProvider, useSession } from "@/lib/session";

void SplashScreen.preventAutoHideAsync().catch(() => {});

// Refetch when the app comes back to the foreground (TanStack's default only knows browser focus).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
}

// Before the grid owned preferences they lived under mahaam.* keys. Carry them over once, before
// PrefsProvider reads its own, so an update keeps the user's language and appearance.
function MigratePrefs({ children }: { children: ReactNode }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    (async () => {
      const [[, oldLocale], [, oldTheme], [, locale], [, theme]] = await AsyncStorage.multiGet([
        "mahaam.locale",
        "mahaam.theme",
        "prefs.locale",
        "prefs.theme",
      ]);
      const writes: [string, string][] = [];
      if (!locale && (oldLocale === "en" || oldLocale === "ar")) writes.push(["prefs.locale", oldLocale]);
      if (!theme && (oldTheme === "light" || oldTheme === "dark" || oldTheme === "system")) writes.push(["prefs.theme", oldTheme]);
      if (writes.length) await AsyncStorage.multiSet(writes);
      await AsyncStorage.multiRemove(["mahaam.locale", "mahaam.theme"]);
      setDone(true);
    })();
  }, []);
  return done ? children : null;
}

function Navigator() {
  const ready = useGridReady();
  const navTheme = useNavTheme();
  const { theme, colors, isRTL } = usePrefs();
  const { status } = useSession();
  // Paint the native root view in the theme's ground. Switching to Arabic reloads the app once to
  // flip the layout to RTL; without this the reload shows a bare white window for a second or two,
  // which reads as a crash (it was reported as one).
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);
  // The splash stays up until fonts, prefs and the stored session are known: a first frame in the
  // wrong direction, face or screen is visible.
  if (!ready || status === "loading") return null;
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <View style={[{ flex: 1, backgroundColor: colors.bg }, dirStyle(isRTL)]}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" options={{ gestureEnabled: false, animation: "fade" }} />
          <Stack.Screen name="sign-in" options={{ gestureEnabled: false, animation: "fade" }} />
          <Stack.Screen name="workspaces" />
          <Stack.Screen name="(staff)" />
          <Stack.Screen name="(customer)" />
          <Stack.Screen name="file" options={{ presentation: "modal" }} />
        </Stack>
      </View>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24, buster: "v1" }}>
      <SafeAreaProvider>
        <MigratePrefs>
          <PrefsProvider app={APP}>
            <StringsProvider strings={strings}>
              <SessionProvider>
                <Navigator />
              </SessionProvider>
            </StringsProvider>
          </PrefsProvider>
        </MigratePrefs>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}
