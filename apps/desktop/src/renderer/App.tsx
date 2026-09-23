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
import { SignIn } from "@/views/SignIn";

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
    html.dataset.brand = "mahaam";
    html.classList.add("grid-surface");
    html.classList.toggle("dark", dark);
    html.toggleAttribute("data-fullscreen", fullscreen);
  }, [locale, dark, config.platform, fullscreen]);

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider delay={400}>
        {session?.workspace ? (
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
