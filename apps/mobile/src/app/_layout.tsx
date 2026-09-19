import { focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider, useI18n } from "@/i18n";
import { persister, queryClient } from "@/lib/query";
import { SessionProvider, useSession } from "@/lib/session";
import { ThemeProvider, useTheme } from "@/theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});

// Refetch when the app comes back to the foreground (TanStack's default only knows browser focus).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
}

function Shell() {
  const { c, scheme } = useTheme();
  const { rtl, t } = useI18n();
  const { status } = useSession();
  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync().catch(() => {});
  }, [status]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: rtl ? "rtl" : "ltr" }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.fg,
          headerTitleStyle: { color: c.fg },
          contentStyle: { backgroundColor: c.bg },
          headerBackTitle: t("common.back"),
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="workspaces" options={{ title: t("ws.title") }} />
        <Stack.Screen name="(team)" options={{ headerShown: false }} />
        <Stack.Screen name="(client)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
        <Stack.Screen name="task/[key]" options={{ title: "" }} />
        <Stack.Screen name="project/[id]" options={{ title: "" }} />
        <Stack.Screen name="issue/[key]" options={{ title: "" }} />
        <Stack.Screen name="invoice/[id]" options={{ title: "" }} />
        <Stack.Screen name="file" options={{ title: "", presentation: "modal" }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24, buster: "v1" }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <SessionProvider>
              <Shell />
            </SessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}
