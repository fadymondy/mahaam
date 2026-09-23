// Updates: found, downloaded and installed by themselves, with the person kept in the loop.
//
//   checking → available (downloading in the background, with progress) → ready
//   → a prompt: "Restart now" installs immediately; "Later" installs on the next quit.
//
// Every state is broadcast to the windows (the renderer's update pill shows the download and the
// prompt) and also offered once as a native notification when ready, since the window may be
// hidden. electron-updater refuses an update whose signature does not match the running app, so
// this is off for unpackaged runs; MAHAAM_FAKE_UPDATE=1 plays the whole cycle for the e2e and for
// looking at the UI.
import { app, BrowserWindow, Notification } from "electron";

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

type Updater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

const EVERY_HOURS = 4;

let state: UpdateState = { state: "idle" };
let timer: ReturnType<typeof setInterval> | null = null;
let updater: Updater | null = null;
let fake = false;
let notified = "";
let onReady: (() => void) | null = null;

function set(next: UpdateState): void {
  state = next;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("update", state);
  if (next.state === "ready" && notified !== next.version) {
    notified = next.version;
    onReady?.();
  }
}

export const updateState = () => state;

/** Starts background checks. `notify` shows the "ready" notification (localized by the caller). */
export function startUpdates(opts: { notify: (version: string) => void }): void {
  onReady = () => state.state === "ready" && opts.notify(state.version);
  if (process.env.MAHAAM_FAKE_UPDATE === "1") {
    fake = true;
    return; // the e2e (or a person looking at the UI) runs the cycle with checkNow()
  }
  if (!app.isPackaged || process.env.MAHAAM_NO_UPDATES === "1") return;
  try {
    // Required lazily so development and the e2e do not need the dependency.
    updater = (require("electron-updater") as { autoUpdater: Updater }).autoUpdater;
  } catch (err) {
    console.warn("[updates] electron-updater unavailable; updates are off", err);
    return;
  }
  // Download on its own; install when the person says so, or on the next quit.
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("checking-for-update", () => set({ state: "checking" }));
  updater.on("update-available", (info: unknown) => set({ state: "downloading", version: (info as { version?: string })?.version ?? "", percent: 0 }));
  updater.on("download-progress", (p: unknown) => {
    const version = state.state === "downloading" ? state.version : "";
    set({ state: "downloading", version, percent: Math.round((p as { percent?: number })?.percent ?? 0) });
  });
  updater.on("update-downloaded", (info: unknown) => set({ state: "ready", version: (info as { version?: string })?.version ?? "" }));
  updater.on("update-not-available", () => set({ state: "idle" }));
  updater.on("error", (err: unknown) => {
    console.warn("[updates] failed", err);
    // A failed check is not the person's problem; say nothing unless a download was under way.
    set(state.state === "downloading" ? { state: "error", message: String((err as Error)?.message ?? err) } : { state: "idle" });
  });
  // Not at the instant of launch: the first seconds belong to restoring the session.
  setTimeout(() => void checkNow(), 20_000);
  timer = setInterval(() => void checkNow(), EVERY_HOURS * 60 * 60 * 1000);
}

/** "Check for Updates…" in the menu, and the timers. */
export async function checkNow(): Promise<void> {
  if (fake) {
    if (state.state === "checking" || state.state === "downloading") return;
    set({ state: "checking" });
    await new Promise((r) => setTimeout(r, 600));
    for (let p = 0; p <= 100; p += 10) {
      set({ state: "downloading", version: "9.9.9", percent: p });
      await new Promise((r) => setTimeout(r, 700));
    }
    set({ state: "ready", version: "9.9.9" });
    return;
  }
  if (!updater || state.state === "downloading" || state.state === "ready") return;
  await updater.checkForUpdates().catch(() => null);
}

/** "Restart now". */
export function installNow(): void {
  if (fake) {
    set({ state: "idle" });
    return;
  }
  if (state.state === "ready") updater?.quitAndInstall(false, true);
}

export function stopUpdates(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** A native notification when the window is hidden: clicking it restarts into the update. */
export function readyNotification(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on("click", onClick);
  n.show();
}
