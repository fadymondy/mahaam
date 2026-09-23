// Settings in its own window (⌘,), like a macOS app's preferences: the Settings view, full-window,
// with no sidebar or app chrome around it. A menu or link that asks for a section re-targets it.
import { useEffect, useState } from "react";

import { useApp } from "@/lib/app";
import { on } from "@/lib/bridge";
import { SettingsView } from "@/views/Settings";
import { SignIn } from "@/views/SignIn";

export function SettingsWindow() {
  const { session } = useApp();
  const [section, setSection] = useState(() => new URLSearchParams(location.search).get("section") ?? undefined);
  useEffect(() => on("command", (c) => c.type === "settings" && setSection(c.section)), []);
  if (!session?.workspace) return <SignIn />;
  return (
    <div className="flex h-full flex-col bg-background" data-settings-window>
      <SettingsView key={section ?? ""} section={section} />
    </div>
  );
}
