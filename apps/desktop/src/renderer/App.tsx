// The root: data, app state, language and theme, then the sign-in screen or the signed-in shell.
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/lib/app";
import { I18nProvider } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { RouterProvider } from "@/lib/router";
import { AppShell } from "@/shell/AppShell";
import { Popover } from "@/surfaces/Popover";
import { QuickPalette } from "@/surfaces/QuickPalette";
import { IssueWindow } from "@/surfaces/IssueWindow";
import { SettingsWindow } from "@/surfaces/SettingsWindow";
import { SignIn } from "@/views/SignIn";

/** Which window this renderer is (main.ts / surfaces.ts load the same bundle with ?surface=). */
export const SURFACE = (new URLSearchParams(location.search).get("surface") ?? "main") as "main" | "popover" | "palette" | "settings" | "issue";

function useDark(theme: "system" | "light" | "dark"): boolean {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const [system, setSystem] = useState(mq.matches);
  useEffect(() => {
    const on = (e: MediaQueryListEvent) => setSystem(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mq]);
  return theme === "dark" || (theme === "system" && system);
}

function Root() {
  const { prefs, session, config, fullscreen } = useApp();
  const dark = useDark(prefs.theme);
  const locale = prefs.locale;

  useEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === "ar" ? "rtl" : "ltr";
    html.dataset.platform = config.platform;
    // Where the window's own buttons are: the macOS traffic lights follow the app's native
    // direction (fixed at launch, main/app-language.ts); Windows/Linux caption buttons are top-right.
    html.dataset.lights = config.platform === "darwin" ? (config.nativeRtl ? "right" : "left") : "caption";
    html.dataset.surface = SURFACE;
    html.dataset.brand = "mahaam";
    html.classList.add("grid-surface");
    html.classList.toggle("dark", dark);
    html.toggleAttribute("data-fullscreen", fullscreen);
  }, [locale, dark, config.platform, config.nativeRtl, fullscreen]);

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider delay={400}>
        {SURFACE === "popover" ? (
          <Popover />
        ) : SURFACE === "palette" ? (
          <QuickPalette />
        ) : SURFACE === "settings" ? (
          <SettingsWindow />
        ) : SURFACE === "issue" ? (
          <IssueWindow />
        ) : session?.workspace ? (
          <RouterProvider>
            <AppShell />
          </RouterProvider>
        ) : (
          <SignIn />
        )}
        <Toaster theme={dark ? "dark" : "light"} position="bottom-right" dir={locale === "ar" ? "rtl" : "ltr"} toastOptions={{ className: "brand-surface" }} />
      </TooltipProvider>
    </I18nProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider fallback={<div className="h-full bg-background" />}>
        <Root />
      </AppProvider>
    </QueryClientProvider>
  );
}
