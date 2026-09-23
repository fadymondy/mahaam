// The signed-in window: sidebar + the current view, with the global keyboard map, the dialogs any
// view can open (⌘K, quick create, the timer palette) and the commands the main process sends
// (menu bar, menu-bar timer, notifications, mahaam:// links).
import { useCallback, useEffect, useMemo, useState } from "react";

import { useApp } from "@/lib/app";
import { desktop, on } from "@/lib/bridge";
import { useHotkey } from "@/lib/hotkeys";
import { useI18n } from "@/lib/i18n";
import { openPalette } from "@/lib/native";
import { useRouter } from "@/lib/router";
import { ShellContext, type Shell } from "@/lib/shell";
import { View } from "@/routes";

import { Sidebar } from "./Sidebar";

export function AppShell() {
  const { prefs, setPrefs, live } = useApp();
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const sidebarOpen = prefs.sidebar !== "collapsed";

  const toggleSidebar = useCallback(() => void setPrefs({ sidebar: sidebarOpen ? "collapsed" : "open" }), [setPrefs, sidebarOpen]);
  const currentProject = route.name === "project" ? route.id : null;
  // Search, a new issue and a timer are all the Spotlight panel (a native NSPanel, surfaces.ts),
  // not dialogs drawn inside this window.
  const openCreate = useCallback((project?: string | null) => void openPalette("create", { project: project ?? currentProject }), [currentProject]);
  const shell = useMemo<Shell>(
    () => ({ sidebarOpen, toggleSidebar, openCreate, openTimer: () => void openPalette("timer"), openPalette: () => void openPalette("search") }),
    [sidebarOpen, toggleSidebar, openCreate],
  );

  useEffect(() => {
    document.documentElement.dataset.sidebar = sidebarOpen ? "open" : "collapsed";
  }, [sidebarOpen]);

  // A mahaam:// link or a notification click that arrived before this window was ready.
  useEffect(() => {
    void desktop.pendingRoute().then((r) => r && navigate(r));
  }, [navigate]);

  // From the main process: the menu bar, the menu-bar timer, notifications, deep links.
  useEffect(
    () =>
      on("command", (c) => {
        if (c.type === "navigate") navigate(c.to);
        else if (c.type === "palette") void openPalette("search");
        else if (c.type === "create") openCreate();
        else if (c.type === "toggle-sidebar") toggleSidebar();
        else if (c.type === "timer-palette") void openPalette("timer");
        else if (c.type === "settings") void desktop.openSettings(c.section);
      }),
    [navigate, openCreate, toggleSidebar],
  );
  useEffect(() => {
    const open = () => void openPalette("timer");
    window.addEventListener("mahaam:timer-palette", open);
    return () => window.removeEventListener("mahaam:timer-palette", open);
  }, []);

  // In-window keys. The ⌘ shortcuts (⌘K, ⌘N, ⌘\, ⌘1–4, ⌘,) are the native menu's accelerators and
  // arrive above as commands, so they are not bound twice here.
  const dialogOpen = false;
  useHotkey("c", () => openCreate(), { enabled: !dialogOpen });
  useHotkey("g i", () => navigate({ name: "inbox" }), { enabled: !dialogOpen });
  useHotkey("g m", () => navigate({ name: "my-issues" }), { enabled: !dialogOpen });
  useHotkey("g p", () => navigate({ name: "projects" }), { enabled: !dialogOpen });
  useHotkey("g t", () => navigate({ name: "time" }), { enabled: !dialogOpen });
  useHotkey("/", () => void openPalette("search"), { enabled: !dialogOpen });

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full">
        {sidebarOpen ? <Sidebar onSearch={() => void openPalette("search")} onCreate={() => openCreate()} onCollapse={toggleSidebar} /> : null}
        <main className="relative flex min-w-0 flex-1 flex-col bg-background" data-route={route.name}>
          <View route={route} />
          {live === "reconnecting" ? (
            // The live stream dropped (network, sleep): say so quietly; it reconnects by itself.
            <div role="status" className="pointer-events-none absolute bottom-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 rounded-full border border-line bg-grid-card px-3 py-1 text-[12.5px] text-grid-muted shadow-sm" data-live-status>
              {t("common.reconnecting")}
            </div>
          ) : null}
        </main>
      </div>

    </ShellContext.Provider>
  );
}
