// Settings in its own window (⌘,), like a macOS app's preferences: the Settings view, full-window,
// with no sidebar or app chrome around it. Its sections navigate a router of its own (not saved, so
// the main window still reopens where it was); a menu or link that asks for a section re-targets it.
import { useEffect } from "react";

import { useApp } from "@/lib/app";
import { on } from "@/lib/bridge";
import { RouterProvider, useRouter } from "@/lib/router";
import { SettingsView } from "@/views/Settings";
import { SignIn } from "@/views/SignIn";

export function SettingsWindow() {
  const { session } = useApp();
  if (!session?.workspace) return <SignIn />;
  const section = new URLSearchParams(location.search).get("section") ?? undefined;
  return (
    <RouterProvider start={{ name: "settings", section }} persist={false}>
      <Sections />
    </RouterProvider>
  );
}

function Sections() {
  const { route, navigate } = useRouter();
  useEffect(() => on("command", (c) => c.type === "settings" && navigate({ name: "settings", section: c.section })), [navigate]);
  const section = route.name === "settings" ? route.section : undefined;
  return (
    <div className="flex h-full flex-col" data-settings-window>
      <SettingsView section={section} />
    </div>
  );
}
