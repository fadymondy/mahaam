// Mahaam for desktop — the main process.
//
// A native client, not a web page in a frame: the main process owns the services (the device
// session in the OS keychain, the API, the live stream, the menu-bar timer, OS notifications,
// idle detection, deep links, updates) and the renderer is the app's own desktop UI, built from
// the same grid and components as the web. The renderer has no network and no Node: it asks this
// process for data over a fixed IPC surface (preload.ts) and is told about changes as they happen.
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, liveStream, type LiveEvent, type LiveHandle } from "@mahaam/client";

import type { AppConfig, Command, Prefs, Route, TimeEntry } from "../shared/types";
import { makeApi, type Api } from "./api";
import { startIdleWatch } from "./idle-watch";
import * as session from "./session";
import * as store from "./store";
import { idleStrings, menuStrings, trayStrings } from "./strings";
import { createTray, getRecent, getRunning, refreshTray, setRecent, setRunning, trayProbe } from "./tray";
import { startUpdates, stopUpdates } from "./updates";

const DEV_URL = process.env.MAHAAM_DEV_URL; // the Vite dev server (npm run dev)
const SERVER_ARG = process.argv.find((a) => a.startsWith("--server="))?.slice("--server=".length);
const PROTOCOL = "mahaam";
const IS_MAC = process.platform === "darwin";
const TIMER_SHORTCUT = "CommandOrControl+Alt+Shift+M";

// Its own directory: the tray app (apps/tray, productName "Mahaam" too) lives in the default one,
// and Electron's single-instance lock is keyed by it.
app.setPath("userData", process.env.MAHAAM_USER_DATA || join(app.getPath("appData"), "Mahaam Desktop"));
if (!app.requestSingleInstanceLock()) app.exit(0);

let win: BrowserWindow | null = null;
let prefs: Prefs = store.loadPrefs();
let api: Api | null = null;
let live: LiveHandle | null = null;
let liveStatus: "open" | "reconnecting" | "closed" = "closed";
let stopIdle: (() => void) | null = null;
let quitting = false;
let pendingRoute: Route | null = null;

// ── windows ─────────────────────────────────────────────────────────────────

type Bounds = { x?: number; y?: number; width: number; height: number; maximized?: boolean };
const boundsFile = () => join(app.getPath("userData"), "window.json");

function readBounds(): Bounds {
  try {
    const b = JSON.parse(readFileSync(boundsFile(), "utf8")) as Bounds;
    if (b.width >= 900 && b.height >= 560) return b;
  } catch {}
  return { width: 1280, height: 820 };
}

function saveBounds(w: BrowserWindow): void {
  try {
    writeFileSync(boundsFile(), JSON.stringify({ ...w.getNormalBounds(), maximized: w.isMaximized() }));
  } catch {}
}

const background = () => (nativeTheme.shouldUseDarkColors ? "#0b1429" : "#f0ebe1");

function createWindow(): BrowserWindow {
  const b = readBounds();
  const w = new BrowserWindow({
    width: b.width,
    height: b.height,
    ...(b.x !== undefined ? { x: b.x, y: b.y } : {}),
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: "Mahaam",
    backgroundColor: background(),
    titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
    ...(IS_MAC
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: background(), symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e4da" : "#1a1a1a", height: 44 } }),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (b.maximized) w.maximize();
  w.once("ready-to-show", () => {
    if (process.env.MAHAAM_E2E_HIDDEN !== "1") w.show();
  });
  w.on("close", (e) => {
    saveBounds(w);
    if (quitting) return;
    // Closing hides (like Mail, Slack and Linear): the app, its menu-bar timer and its
    // notifications keep running. Quit is ⌘Q, the tray, or the app menu.
    e.preventDefault();
    if (w.isFullScreen()) {
      w.once("leave-full-screen", () => w.hide());
      w.setFullScreen(false);
    } else w.hide();
  });
  w.on("closed", () => {
    if (win === w) win = null;
  });
  w.on("enter-full-screen", () => send("window", { fullscreen: true }));
  w.on("leave-full-screen", () => send("window", { fullscreen: false }));

  // The renderer is our own files. Anything it tries to open elsewhere goes to the browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://")) return;
    e.preventDefault();
    openExternal(url);
  });

  if (DEV_URL) void w.loadURL(DEV_URL);
  else void w.loadFile(join(__dirname, "renderer", "index.html"));
  return w;
}

function show(): void {
  win ??= createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function command(c: Command): void {
  show();
  send("command", c);
}

function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") void shell.openExternal(u.toString());
  } catch {}
}

/** A path on the web console (e.g. for "Open in Browser"). */
function webUrl(path = ""): string {
  const s = session.current();
  const base = session.apiUrl();
  const ws = s?.workspace?.slug;
  return `${base}/${prefs.locale}${ws ? `/w/${ws}` : "/workspaces"}${path}`;
}

// ── services: session → api, live stream, tray, idle ────────────────────────

function applySession(): void {
  const c = session.api();
  const s = session.current();
  live?.close();
  live = null;
  stopIdle?.();
  stopIdle = null;
  api = c && s?.workspace ? makeApi(c, { timerChanged: (r) => onRunning(r) }) : null;
  if (!api || !c) {
    onRunning(null);
    setRecent([], "");
    app.setBadgeCount(0);
    refreshTray();
    return;
  }
  const a = api;
  void a.running().then(onRunning, () => null);
  void refreshRecent();
  void refreshBadge();
  live = liveStream(c, onLive, {
    onStatus: (st) => {
      liveStatus = st;
      send("live:status", st);
    },
  });
  if (prefs.idle) {
    stopIdle = startIdleWatch({
      running: () => getRunning(),
      cut: (id, endedAt) => a.updateEntry(id, { ended_at: endedAt }).then(() => onRunning(null)),
      strings: () => idleStrings(prefs.locale),
      log: (m, e) => console.error("[idle]", m, e),
    });
  }
  refreshTray();
}

function onRunning(r: TimeEntry | null): void {
  const was = getRunning();
  setRunning(r);
  send("running", r);
  if ((was?.id ?? null) !== (r?.id ?? null)) void refreshRecent();
}

async function refreshRecent(): Promise<void> {
  if (!api) return;
  try {
    setRecent(await api.entries({ limit: 40 }), trayStrings(prefs.locale).untitled);
  } catch {}
}

async function refreshBadge(): Promise<void> {
  if (!api) return;
  try {
    const inbox = await api.notifications(1);
    app.setBadgeCount(inbox.unread ?? 0);
    send("unread", inbox.unread ?? 0);
  } catch {}
}

function onLive(e: LiveEvent): void {
  if (e.type === "timer.state") onRunning(e.running);
  else if (e.type === "timer.started") onRunning(e.entry);
  else if (e.type === "timer.stopped") {
    if (getRunning()?.id === e.entry.id) onRunning(null);
    void refreshRecent();
  } else if (e.type === "entry.changed") void refreshRecent();
  else if (e.type === "notification") {
    void refreshBadge();
    if (e.name === "notification.created") notifyFromLive(e.data);
  }
  send("live", e);
}

/** An inbox event as an OS notification; clicking it opens the issue in the app. */
function notifyFromLive(data: unknown): void {
  if (!prefs.notify || !Notification.isSupported()) return;
  const n = data as { title?: unknown; body?: unknown; url?: unknown } | null;
  const title = typeof n?.title === "string" ? n.title.trim() : "";
  if (!title) return;
  const body = typeof n?.body === "string" ? n.body : "";
  const url = typeof n?.url === "string" ? n.url : "";
  const key = /\b([A-Z][A-Z0-9]{0,9}-\d+)\b/.exec(url)?.[1];
  const note = new Notification({ title, body });
  note.on("click", () => command({ type: "navigate", to: key ? { name: "issue", key } : { name: "inbox" } }));
  note.show();
}

// ── menu ──────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const s = menuStrings(prefs.locale);
  const nav = (label: string, accelerator: string, to: Route): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => command({ type: "navigate", to }),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(IS_MAC
      ? [
          {
            label: "Mahaam",
            submenu: [
              { role: "about" as const, label: s.about },
              { type: "separator" as const },
              { label: s.settings, accelerator: "Cmd+,", click: () => command({ type: "settings" }) },
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
        { label: s.newIssue, accelerator: "CmdOrCtrl+N", click: () => command({ type: "create" }) },
        { label: s.startTimer, accelerator: "CmdOrCtrl+Shift+T", click: () => command({ type: "timer-palette" }) },
        { type: "separator" },
        { label: s.openWeb, click: () => openExternal(webUrl()) },
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
      ],
    },
    {
      label: s.view,
      submenu: [
        { label: s.palette, accelerator: "CmdOrCtrl+K", click: () => command({ type: "palette" }) },
        { label: s.toggleSidebar, accelerator: "CmdOrCtrl+\\", click: () => command({ type: "toggle-sidebar" }) },
        {
          label: s.appearance,
          submenu: (["system", "light", "dark"] as const).map((theme) => ({
            label: s[theme],
            type: "radio" as const,
            checked: prefs.theme === theme,
            click: () => setPrefs({ theme }),
          })),
        },
        {
          label: s.language,
          submenu: [
            { label: "English", type: "radio", checked: prefs.locale === "en", click: () => setPrefs({ locale: "en" }) },
            { label: "العربية", type: "radio", checked: prefs.locale === "ar", click: () => setPrefs({ locale: "ar" }) },
          ],
        },
        { type: "separator" },
        { role: "resetZoom", label: s.actualSize },
        { role: "zoomIn", label: s.zoomIn },
        { role: "zoomOut", label: s.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: s.fullScreen },
        ...(app.isPackaged ? [] : [{ role: "reload" as const }, { role: "toggleDevTools" as const }]),
      ],
    },
    {
      label: s.go,
      submenu: [
        nav(s.inbox, "CmdOrCtrl+1", { name: "inbox" }),
        nav(s.myIssues, "CmdOrCtrl+2", { name: "my-issues" }),
        nav(s.projects, "CmdOrCtrl+3", { name: "projects" }),
        nav(s.time, "CmdOrCtrl+4", { name: "time" }),
      ],
    },
    { label: s.window, role: "windowMenu" },
    {
      label: s.help,
      role: "help",
      submenu: [
        { label: s.website, click: () => openExternal("https://mahaam.app") },
        { label: s.privacy, click: () => openExternal(`${session.apiUrl()}/${prefs.locale}/legal/privacy`) },
        { label: s.terms, click: () => openExternal(`${session.apiUrl()}/${prefs.locale}/legal/terms`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setPrefs(patch: Partial<Prefs>): Prefs {
  const before = prefs;
  prefs = { ...prefs, ...patch };
  store.savePrefs(prefs);
  if (patch.theme) applyTheme();
  if (patch.locale && patch.locale !== before.locale) {
    buildMenu();
    refreshTray();
    void refreshRecent();
  }
  if (patch.theme || patch.locale) buildMenu();
  if (patch.idle !== undefined && patch.idle !== before.idle) applySession();
  send("prefs", prefs);
  return prefs;
}

function applyTheme(): void {
  nativeTheme.themeSource = prefs.theme;
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(background());
    if (!IS_MAC) win.setTitleBarOverlay({ color: background(), symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e4da" : "#1a1a1a" });
  }
}

// ── IPC: a fixed surface, only from our own renderer ─────────────────────────

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error("untrusted sender");
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      // Errors cross as data (status + message), so the renderer can tell a 401 from a 422.
      const status = err instanceof ApiError ? err.status : 0;
      const body = err instanceof ApiError ? err.body : undefined;
      return { ok: false, status, message: err instanceof Error ? err.message : String(err), body };
    }
  });
}

function registerIpc(): void {
  handle("app:config", (): AppConfig => ({
    platform: process.platform,
    version: app.getVersion(),
    defaultApiUrl: session.defaultApiUrl(SERVER_ARG),
    lastEmail: session.lastEmail(),
    prefs,
    canAutoLaunch: process.platform !== "linux",
  }));
  handle("app:prefs", (patch: Partial<Prefs>) => {
    const clean: Partial<Prefs> = {};
    if (patch?.theme === "system" || patch?.theme === "light" || patch?.theme === "dark") clean.theme = patch.theme;
    if (patch?.locale === "en" || patch?.locale === "ar") clean.locale = patch.locale;
    if (typeof patch?.notify === "boolean") clean.notify = patch.notify;
    if (typeof patch?.idle === "boolean") clean.idle = patch.idle;
    if (patch?.sidebar === "open" || patch?.sidebar === "collapsed") clean.sidebar = patch.sidebar;
    return setPrefs(clean);
  });
  handle("app:openExternal", (url: string) => openExternal(String(url)));
  handle("app:openWeb", (path?: string) => openExternal(webUrl(typeof path === "string" ? path : "")));
  handle("app:autoLaunch:get", () => app.getLoginItemSettings().openAtLogin);
  handle("app:autoLaunch:set", (on: boolean) => app.setLoginItemSettings({ openAtLogin: !!on }));
  handle("app:pendingRoute", () => {
    const r = pendingRoute;
    pendingRoute = null;
    return r;
  });

  handle("session:get", () => session.current());
  handle("session:signIn", (apiUrl: string, email: string, password: string, second?: { code?: string; recovery_code?: string }) =>
    session.signIn(String(apiUrl), String(email), String(password), second),
  );
  handle("session:signInBrowser", (apiUrl: string) => session.signInWithBrowser(String(apiUrl), win, prefs.locale));
  handle("session:signOut", () => session.signOut());
  handle("session:selectWorkspace", (id: string) => session.selectWorkspace(String(id)));

  handle("timer:running", () => getRunning());
  handle("live:status", () => liveStatus);

  handle("api", (method: string, args: unknown[]) => {
    if (!api) throw new ApiError(401, "sign in required");
    const fn = (api as Record<string, unknown>)[method];
    if (typeof fn !== "function" || !Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`unknown method ${method}`);
    return (fn as (...a: unknown[]) => Promise<unknown>)(...(Array.isArray(args) ? args : []));
  });
}

// ── deep links: mahaam://issue/MH-12, mahaam://project/<id>, mahaam://inbox ───

function routeFromLink(link: string): Route | null {
  try {
    const u = new URL(link);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    const parts = [u.host, ...u.pathname.split("/")].filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "issue" && parts[1]) return { name: "issue", key: parts[1] };
    if (parts[0] === "project" && parts[1]) return { name: "project", id: parts[1] };
    if (parts[0] === "inbox") return { name: "inbox" };
    if (parts[0] === "time") return { name: "time" };
    if (parts[0] === "my-issues") return { name: "my-issues" };
    return null;
  } catch {
    return null;
  }
}

function openLink(link: string): void {
  const to = routeFromLink(link);
  if (!to) return;
  if (!app.isReady() || !win) pendingRoute = to;
  else command({ type: "navigate", to });
}

app.on("open-url", (e, link) => {
  e.preventDefault();
  openLink(link);
});

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) openLink(link);
  else show();
});

if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
else app.setAsDefaultProtocolClient(PROTOCOL);

// ── lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  applyTheme();
  registerIpc();
  buildMenu();
  const initialLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (initialLink) pendingRoute = routeFromLink(initialLink);

  await session.restore();
  session.onSession((s, reason) => {
    applySession();
    send("session", s, reason);
  });
  applySession();

  createTray({
    locale: () => prefs.locale,
    signedIn: () => !!api,
    show,
    timerPalette: () => command({ type: "timer-palette" }),
    stop: async () => (api ? api.stop() : undefined),
    start: async (input) => (api ? api.start(input) : undefined),
  });
  // Stop the running timer, or resume the last thing worked on — from anywhere.
  globalShortcut.register(TIMER_SHORTCUT, () => {
    if (!api) return show();
    if (getRunning()) void api.stop();
    else {
      const last = getRecent()[0]?.input;
      if (last) void api.start(last);
      else command({ type: "timer-palette" });
    }
  });
  if (process.env.MAHAAM_E2E === "1") Object.assign(globalThis, { mahaamTray: trayProbe });

  win = createWindow();
  startUpdates(() => win);
});


app.on("activate", () => show());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  live?.close();
  stopIdle?.();
  stopUpdates();
});
// The menu-bar timer keeps the app alive with no windows; quitting is explicit.
app.on("window-all-closed", () => {});
