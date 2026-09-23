// Auto-update, and the several ways it can go wrong quietly.
//
// electron-updater refuses to install an update whose signature does not match the running app,
// which is correct and also means an unsigned build can never update itself. Rather than let it
// fail on every check, this stays off unless the app is packaged — a developer running from
// source is not who this is for, and the error it would produce every hour is noise that trains
// people to ignore the log.
//
// Nothing is installed without the user saying so. A tray timer that restarts itself mid-session
// loses whatever the person was typing into it, and "it disappeared" is a worse bug than "it is
// one version behind".
import { app, dialog, type BrowserWindow } from "electron"

/** Hours between checks. Frequent enough to matter, rare enough not to be a background job. */
const EVERY_HOURS = 6

type Updater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Starts periodic update checks. Safe to call unconditionally: it returns immediately when the
 * app is not packaged, and a missing electron-updater is a warning rather than a crash — the
 * tray's job is to run a timer, not to update itself.
 */
export function startUpdates(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return
  if (process.env.MAHAAM_NO_UPDATES === "1") return // for a packaged build under test

  let updater: Updater
  try {
    // Required lazily so `npm run dev` and the e2e do not need the dependency present.
    updater = (require("electron-updater") as { autoUpdater: Updater }).autoUpdater
  } catch (err) {
    console.warn("[updates] electron-updater unavailable; updates are off", err)
    return
  }

  // Download only after the person agrees. See the note at the top.
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false

  updater.on("error", (err) => console.warn("[updates] check failed", err))

  updater.on("update-available", (info: unknown) => {
    const version = (info as { version?: string })?.version ?? ""
    const win = getWindow()
    const opts = {
      type: "info" as const,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Mahaam",
      message: version ? `Mahaam ${version} is available.` : "An update is available.",
      detail: "It will install the next time you quit Mahaam. Your running timer is not affected.",
    }
    const choice = win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)
    if (choice === 0) void updater.downloadUpdate().catch((e) => console.warn("[updates] download failed", e))
  })

  updater.on("update-downloaded", () => {
    // Installed on quit, not now. Interrupting a running timer to apply an update is exactly the
    // behaviour that makes people uninstall a tray app.
    updater.autoInstallOnAppQuit = true
  })

  const check = () => void updater.checkForUpdates().catch(() => null)
  // Not at the instant of launch: the first seconds belong to restoring the session and showing
  // the tray, and a network call competing with that is felt.
  setTimeout(check, 30_000)
  timer = setInterval(check, EVERY_HOURS * 60 * 60 * 1000)
}

export function stopUpdates(): void {
  if (timer) clearInterval(timer)
  timer = null
}
