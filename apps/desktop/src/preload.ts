// The page's only door to the desktop: a few one-way messages and one command stream, exposed as
// window.mahaamDesktop. The web app treats its presence as "running in the desktop app"
// (web/components/desktop/desktop-bridge.tsx).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type DesktopCommand = { type: string; [key: string]: unknown };

const api = {
  platform: process.platform,
  setTheme: (theme: "light" | "dark" | "system") => ipcRenderer.send("desktop:theme", theme),
  setLocale: (locale: "en" | "ar") => ipcRenderer.send("desktop:locale", locale),
  setBadge: (count: number) => ipcRenderer.send("desktop:badge", count),
  setTimer: (timer: unknown) => ipcRenderer.send("desktop:timer", timer),
  retry: (url: string) => ipcRenderer.send("desktop:retry", url),
  onCommand(cb: (command: DesktopCommand) => void): () => void {
    const listener = (_e: IpcRendererEvent, command: DesktopCommand) => cb(command);
    ipcRenderer.on("desktop:command", listener);
    return () => ipcRenderer.removeListener("desktop:command", listener);
  },
};

contextBridge.exposeInMainWorld("mahaamDesktop", api);
