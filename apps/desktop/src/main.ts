// Mahaam for desktop — main process.
//
// The window is the web console itself (the same grid, components and en/ar behaviour as the
// browser; epic MH-89 decided the desktop UI is not a second design language). What this file adds
// is what a browser tab cannot be: a real macOS/Windows window with the traffic lights inset into
// the app's own header, a native menu bar with keyboard shortcuts, a dock badge, mahaam:// deep
// links, remembered window bounds and an offline screen.
//
// The page never gets Node: sandboxed renderer, context isolation, and a preload that exposes a
// handful of whitelisted calls (preload.ts). Everything off the Mahaam origin opens in the
// system browser, except the sign-in providers, which must complete in-window to land the session
// cookie in this app.
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { menuStrings, type Locale } from "./strings";
import { createTray, refreshTrayLocale, setTimerState, toggleTimer, trayProbe, type TimerState } from "./tray";

// `--server=<url>` (e.g. `open -a Mahaam --args --server=http://127.0.0.1:3010`) or MAHAAM_URL
// points the app at another console, such as a local stack.
const SERVER_ARG = process.argv.find((a) => a.startsWith("--server="))?.slice("--server=".length);
const APP_URL = new URL(SERVER_ARG || process.env.MAHAAM_URL || "https://console.mahaam.app");
const ORIGIN = APP_URL.origin;
const PROTOCOL = "mahaam";
const IS_MAC = process.platform === "darwin";
/** The web header is h-14 (56px); the traffic lights are centred on it. */
const HEADER = 56;
/** Sign-in providers that have to run in-window so the session cookie lands in this app. */
const AUTH_HOSTS = ["accounts.google.com", "github.com", "appleid.apple.com"];

// Not the default ("Mahaam", from productName): the tray app (apps/tray) already lives there, and
// Electron's single-instance lock is keyed by this directory, so sharing it would let one app
// refuse to start while the other runs.
app.setPath("userData", process.env.MAHAAM_USER_DATA || join(app.getPath("appData"), "Mahaam Desktop"));
if (!app.requestSingleInstanceLock()) app.exit(0);

// The page reads this token server-side to render the desktop chrome on the first paint (no flash
// of a header without room for the traffic lights). "Electron/x" is dropped: Google refuses to
// sign in inside anything that announces itself as an embedded browser.
app.userAgentFallback =
  app.userAgentFallback.replace(/ Electron\/\S+/, "").replace(/ @?mahaam\S*\/\S+/i, "") +
  ` MahaamDesktop/${app.getVersion()} (${process.platform})`;

let locale: Locale = "en";
let pendingDeepLink: string | null = null;
/** Set by Quit; until then closing the last window hides it, so the menu-bar timer stays live. */
let quitting = false;
/** The page that last reported the timer: tray commands go back to it. */
let timerPage: WebContents | null = null;

// ── window state ────────────────────────────────────────────────────────────

type Bounds = { x?: number; y?: number; width: number; height: number; maximized?: boolean };
const stateFile = () => join(app.getPath("userData"), "window.json");

function readBounds(): Bounds {
  try {
    const b = JSON.parse(readFileSync(stateFile(), "utf8")) as Bounds;
    if (b.width >= 960 && b.height >= 600) return b;
  } catch {}
  return { width: 1440, height: 900 };
}

function saveBounds(win: BrowserWindow): void {
  try {
    const b = win.getNormalBounds();
    writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {}
}

// ── windows ─────────────────────────────────────────────────────────────────

const bg = () => (nativeTheme.shouldUseDarkColors ? "#0f0f10" : "#ffffff");

function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

function isAuthUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && AUTH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function createWindow(url: string = APP_URL.href, cascade = false): BrowserWindow {
  const saved = readBounds();
  const from = BrowserWindow.getFocusedWindow();
  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(cascade && from
      ? { x: from.getBounds().x + 28, y: from.getBounds().y + 28 }
      : saved.x !== undefined
        ? { x: saved.x, y: saved.y }
        : {}),
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Mahaam",
    backgroundColor: bg(),
    // macOS: the traffic lights float over the web header. Windows/Linux: the native caption
    // buttons are drawn over the header's end instead, in the page's colours.
    titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
    ...(IS_MAC
      ? { trafficLightPosition: { x: 18, y: HEADER / 2 - 7 } }
      : { titleBarOverlay: { color: bg(), symbolColor: nativeTheme.shouldUseDarkColors ? "#f5f5f5" : "#1a1a1a", height: HEADER - 1 } }),
    webPreferences: {
      // A hidden window still runs the live stream that feeds the menu-bar timer.
      backgroundThrottling: false,
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (!cascade && saved.maximized) win.maximize();

  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    saveBounds(win);
    const others = BrowserWindow.getAllWindows().filter((w) => w !== win && !w.isDestroyed());
    if (quitting || others.length) return;
    // The last window hides instead of closing (like Slack and Linear): its page is what keeps the
    // menu-bar timer live. Quit from the menu, the tray or ⌘Q.
    e.preventDefault();
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => win.hide());
      win.setFullScreen(false);
    } else win.hide();
  });
  win.on("enter-full-screen", () => win.webContents.send("desktop:command", { type: "fullscreen", value: true }));
  win.on("leave-full-screen", () => win.webContents.send("desktop:command", { type: "fullscreen", value: false }));
  guard(win.webContents);
  win.webContents.on("did-fail-load", (_e, code, _desc, failed, isMainFrame) => {
    // -3 is an aborted navigation (a redirect superseded it), not a failure.
    if (!isMainFrame || code === -3) return;
    void win.loadFile(join(__dirname, "..", "static", "offline.html"), {
      query: { url: failed || APP_URL.href, locale },
    });
  });
  void win.loadURL(url);
  return win;
}

/** Keeps the window on Mahaam: other sites open in the browser, never inside the app. */
function guard(wc: WebContents): void {
  wc.on("will-navigate", (e, url) => {
    if (isAppUrl(url) || isAuthUrl(url) || url.startsWith("file:")) return;
    e.preventDefault();
    void openExternal(url);
  });
  wc.on("will-redirect", (e, url) => {
    if (isAppUrl(url) || isAuthUrl(url)) return;
    e.preventDefault();
    void openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    // A Mahaam link opened "in a new tab" becomes a new window, like Linear.
    if (isAppUrl(url)) createWindow(url, true);
    else void openExternal(url);
    return { action: "deny" };
  });
}

function openExternal(url: string): Promise<void> {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") return shell.openExternal(url);
  } catch {}
  return Promise.resolve();
}

function focused(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function show(): void {
  const win = (timerPage && !timerPage.isDestroyed() && BrowserWindow.fromWebContents(timerPage)) || focused();
  if (!win) return void createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Hands a menu command to the page (DesktopBridge in web/components/desktop). */
function command(type: string, extra: Record<string, unknown> = {}): void {
  const win = focused();
  if (!win) return;
  win.webContents.send("desktop:command", { type, ...extra });
}

/** A menu-bar timer command goes to the page that reported the timer, even when it is hidden. */
function timerCommand(type: string, extra: Record<string, unknown> = {}): void {
  if (timerPage && !timerPage.isDestroyed()) timerPage.send("desktop:command", { type, ...extra });
  else command(type, extra);
}

// ── deep links: mahaam://w/<slug>/projects/<id> → <origin>/<locale>/w/<slug>/projects/<id> ──

function deepLinkToUrl(link: string): string | null {
  try {
    const u = new URL(link);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    const path = `/${u.host}${u.pathname}`.replace(/\/+$/, "");
    const withLocale = /^\/(en|ar)(\/|$)/.test(path) ? path : `/${locale}${path}`;
    return new URL(withLocale + u.search, ORIGIN).href;
  } catch {
    return null;
  }
}

function openDeepLink(link: string): void {
  const url = deepLinkToUrl(link);
  if (!url) return;
  if (!app.isReady()) {
    pendingDeepLink = url;
    return;
  }
  const win = focused() ?? createWindow(url);
  if (win.isMinimized()) win.restore();
  win.focus();
  void win.loadURL(url);
}

app.on("open-url", (e, link) => {
  e.preventDefault();
  openDeepLink(link);
});

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) return openDeepLink(link);
  const win = focused();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// ── menu ──────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const s = menuStrings(locale);
  const go = (label: string, accelerator: string, section: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => command("go", { section }),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(IS_MAC
      ? [
          {
            label: "Mahaam",
            submenu: [
              { role: "about" as const, label: s.about },
              { type: "separator" as const },
              { label: s.settings, accelerator: "Cmd+,", click: () => command("go", { section: "me" }) },
              { type: "separator" as const },
              { role: "services" as const, label: s.services },
              { type: "separator" as const },
              { role: "hide" as const, label: s.hide },
              { role: "hideOthers" as const, label: s.hideOthers },
              { role: "unhide" as const, label: s.showAll },
              { type: "separator" as const },
              { role: "quit" as const, label: s.quit },
            ],
          },
        ]
      : []),
    {
      label: s.file,
      submenu: [
        { label: s.newWindow, accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow(focused()?.webContents.getURL() || APP_URL.href, true) },
        { type: "separator" },
        { label: s.reportProblem, click: () => command("report") },
        { type: "separator" },
        IS_MAC ? { role: "close", label: s.closeWindow } : { role: "quit", label: s.quit },
      ],
    },
    {
      label: s.edit,
      submenu: [
        { role: "undo", label: s.undo },
        { role: "redo", label: s.redo },
        { type: "separator" },
        { role: "cut", label: s.cut },
        { role: "copy", label: s.copy },
        { role: "paste", label: s.paste },
        { role: "pasteAndMatchStyle", label: s.pasteMatch },
        { role: "selectAll", label: s.selectAll },
        { type: "separator" },
        { label: s.copyLink, accelerator: "CmdOrCtrl+Shift+C", click: () => command("copy-link") },
      ],
    },
    {
      label: s.view,
      submenu: [
        { label: s.palette, accelerator: "CmdOrCtrl+K", click: () => command("palette") },
        { label: s.toggleSidebar, accelerator: "CmdOrCtrl+B", click: () => command("toggle-nav") },
        {
          label: s.appearance,
          submenu: (["system", "light", "dark"] as const).map((theme) => ({
            label: s[theme],
            type: "radio" as const,
            checked: nativeTheme.themeSource === theme,
            click: () => command("theme", { theme }),
          })),
        },
        {
          label: s.language,
          submenu: [
            { label: "English", type: "radio", checked: locale === "en", click: () => command("locale", { locale: "en" }) },
            { label: "العربية", type: "radio", checked: locale === "ar", click: () => command("locale", { locale: "ar" }) },
          ],
        },
        { type: "separator" },
        { role: "reload", label: s.reload },
        { role: "resetZoom", label: s.actualSize },
        { role: "zoomIn", label: s.zoomIn },
        { role: "zoomOut", label: s.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: s.fullScreen },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
      ],
    },
    {
      label: s.go,
      submenu: [
        { label: s.back, accelerator: "CmdOrCtrl+[", click: () => focused()?.webContents.navigationHistory.goBack() },
        { label: s.forward, accelerator: "CmdOrCtrl+]", click: () => focused()?.webContents.navigationHistory.goForward() },
        { type: "separator" },
        go(s.overview, "CmdOrCtrl+1", "overview"),
        go(s.projects, "CmdOrCtrl+2", "projects"),
        go(s.time, "CmdOrCtrl+3", "time"),
        go(s.reports, "CmdOrCtrl+4", "reports"),
        go(s.members, "CmdOrCtrl+5", "members"),
        { type: "separator" },
        { label: s.workspaces, accelerator: "CmdOrCtrl+Shift+W", click: () => command("go", { section: "workspaces" }) },
      ],
    },
    { label: s.window, role: "windowMenu" },
    {
      label: s.help,
      role: "help",
      submenu: [
        { label: s.website, click: () => void shell.openExternal("https://mahaam.app") },
        { label: s.privacy, click: () => command("go", { section: "privacy" }) },
        { label: s.terms, click: () => command("go", { section: "terms" }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── the bridge ───────────────────────────────────────────────────────────────

// Only the page on the Mahaam origin may call these; a stray frame gets nothing.
function trusted(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return isAppUrl(url) || url.startsWith("file:");
}

ipcMain.on("desktop:theme", (e, theme: unknown) => {
  if (!trusted(e) || (theme !== "light" && theme !== "dark" && theme !== "system")) return;
  nativeTheme.themeSource = theme;
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(bg());
    if (!IS_MAC)
      win.setTitleBarOverlay({ color: bg(), symbolColor: nativeTheme.shouldUseDarkColors ? "#f5f5f5" : "#1a1a1a" });
  }
  buildMenu();
});

ipcMain.on("desktop:locale", (e, next: unknown) => {
  if (!trusted(e) || (next !== "en" && next !== "ar") || next === locale) return;
  locale = next;
  buildMenu();
  refreshTrayLocale();
});

ipcMain.on("desktop:timer", (e, next: unknown) => {
  if (!trusted(e)) return;
  if (next === null) {
    // Only the page that owns the timer may clear it (another window leaving a workspace must not).
    if (timerPage === e.sender) setTimerState(null);
    return;
  }
  const t = next as TimerState;
  if (!t || typeof t !== "object" || !Array.isArray(t.recent)) return;
  const running = t.running && typeof t.running.started_at === "string" && !Number.isNaN(Date.parse(t.running.started_at)) ? t.running : null;
  timerPage = e.sender;
  setTimerState({
    workspace: String(t.workspace ?? ""),
    running: running ? { what: String(running.what ?? ""), where: String(running.where ?? ""), started_at: running.started_at } : null,
    recent: t.recent.slice(0, 5).map((r) => ({ label: String(r.label ?? ""), sub: String(r.sub ?? ""), body: r.body ?? {} })),
  });
});

ipcMain.on("desktop:badge", (e, count: unknown) => {
  if (!trusted(e) || typeof count !== "number" || !Number.isFinite(count)) return;
  app.setBadgeCount(Math.max(0, Math.floor(count)));
});

ipcMain.on("desktop:retry", (e, url: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && typeof url === "string" && isAppUrl(url)) void win.loadURL(url);
});

// ── lifecycle ────────────────────────────────────────────────────────────────

if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
else app.setAsDefaultProtocolClient(PROTOCOL);

app.whenReady().then(() => {
  // The page may ask for notifications (the web's own inbox alerts) and the clipboard, and
  // nothing else: no camera, microphone, location or MIDI for a project tracker.
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
    done(isAppUrl(wc.getURL()) && ["notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen"].includes(permission));
  });
  buildMenu();
  createTray({ show, command: timerCommand, locale: () => locale });
  // The same shortcut as the old tray app: stop, or resume the last thing worked on.
  globalShortcut.register("CommandOrControl+Alt+Shift+M", toggleTimer);
  if (process.env.MAHAAM_E2E === "1") Object.assign(globalThis, { mahaamTray: trayProbe });
  const initial = pendingDeepLink ?? deepLinkToUrl(process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? "");
  createWindow(initial ?? APP_URL.href);
  pendingDeepLink = null;
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) show();
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => globalShortcut.unregisterAll());

// The menu-bar timer keeps the app alive with no windows; Quit is explicit on every platform.
app.on("window-all-closed", () => {});
