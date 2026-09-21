// Mahaam tray — main process. Owns the session (OS keychain via safeStorage), the API client and
// the realtime stream; the popover renderer has no network or Node access and talks to this file
// over a whitelisted IPC bridge (preload.ts).
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  ApiError,
  clock,
  DEFAULT_API_URL,
  duration,
  elapsedSeconds,
  entryLabel,
  liveStream,
  MahaamClient,
  normalizeApiUrl,
  type LiveEvent,
  type LiveHandle,
  type TimeEntry,
  type Workspace,
} from "@mahaam/client";
import { classify, OfflineQueue } from "@mahaam/client";
import { rasterMark } from "@mahaam/client/brand";
import { encodePng } from "@mahaam/client/brand/png";
import { startIdleWatch } from "./idle-watch";
import { queueStore } from "./queue-store";
import * as store from "./store";

const DEV_URL = process.env.MAHAAM_DEV_URL; // Vite dev server (npm run dev:tray)
const DEFAULT_URL = process.env.MAHAAM_API_URL ? normalizeApiUrl(process.env.MAHAAM_API_URL) : DEFAULT_API_URL;
const SHOW_ON_START = !!DEV_URL || process.env.MAHAAM_TRAY_SHOW === "1";
const SHORTCUT = process.env.MAHAAM_SHORTCUT || "CommandOrControl+Alt+Shift+M";
const POPOVER = { width: 380, height: 600 };

// One tray per user: a second launch just opens the first one's popover (see "second-instance").
if (!app.requestSingleInstanceLock()) app.exit(0);
if (process.env.MAHAAM_USER_DATA) app.setPath("userData", process.env.MAHAAM_USER_DATA);

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let client: MahaamClient | null = null;
let live: LiveHandle | null = null;
let running: TimeEntry | null = null;
let stopIdleWatch: (() => void) | null = null;
/** Finished blocks typed while offline. Only logTime is queued: replaying a "start" makes no
 *  sense, and a finished block is exactly what the server can refuse safely as a duplicate. */
const logQueue = new OfflineQueue<unknown[]>(queueStore);
let ticker: ReturnType<typeof setInterval> | null = null;
let secrets: store.Secrets = { token: null };
let stored: Omit<store.Stored, "secret"> | null = null;

// ── session ────────────────────────────────────────────────────────────────

function persist(): void {
  if (!stored) return;
  store.save(stored, secrets.token || secrets.password ? secrets : null);
}

function makeClient(apiUrl: string, token: string | null, workspace: string | null): MahaamClient {
  return new MahaamClient({
    baseUrl: apiUrl,
    csrf: "cookie-header",
    token,
    workspace,
    credentials: () => (stored && secrets.password ? { email: stored.email, password: secrets.password } : null),
    onToken: (t) => {
      secrets.token = t;
      persist();
    },
    onAuthRequired: () => authLost(),
  });
}

function sessionOut() {
  return stored && client?.token ? { apiUrl: stored.apiUrl, email: stored.email, workspace: stored.workspace } : null;
}

function authLost(): void {
  stopLive();
  setRunning(null);
  send("mgy:auth-lost");
}

function restore(): void {
  const s = store.load();
  if (!s) return;
  const { secret: _drop, ...rest } = s.stored;
  stored = rest;
  secrets = s.secrets;
  if (secrets.token || secrets.password) {
    client = makeClient(stored.apiUrl, secrets.token, stored.workspace?.id ?? null);
    startLive();
  }
}

// ── realtime + tray state ─────────────────────────────────────────────────

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function startLive(): void {
  stopLive();
  if (!client?.workspace) return;
  const c = client;
  c.running().then(setRunning, () => null);
  live = liveStream(
    c,
    (e: LiveEvent) => {
      if (e.type === "timer.state") setRunning(e.running);
      else if (e.type === "timer.started") setRunning(e.entry);
      else if (e.type === "timer.stopped" && running?.id === e.entry.id) setRunning(null);
      send("mgy:live", e);
    },
    {
      onStatus: (s) => {
        send("mgy:live-status", s)
        // The stream coming back is the clearest signal the network returned, so replay anything
        // typed while it was down. Failures go back on the queue; a 409 means the server already
        // has it and it is dropped.
        if (s === "open") void flushLogQueue()
      },
    },
  );
  stopIdleWatch?.();
  // Offer to trim time billed while the person was away. Arithmetic lives in @mahaam/client;
  // this only supplies the OS reading and performs the write.
  stopIdleWatch = startIdleWatch({
    running: () => running,
    cut: (id, endedAt) => c.updateEntry(id, { ended_at: endedAt }).then(() => setRunning(null)),
    strings: () => idleStrings(stored?.workspace?.locale === "ar" ? "ar" : "en"),
    log: (m, e) => console.error("[idle]", m, e),
  });
}

function stopLive(): void {
  stopIdleWatch?.();
  stopIdleWatch = null;
  live?.close();
  live = null;
}

function trayIcon(isRunning: boolean): Electron.NativeImage {
  const dark = process.platform === "darwin" ? nativeTheme.shouldUseDarkColors : nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = (process.platform === "darwin" ? 18 : 16) * scale;
    const png = encodePng(rasterMark(size, { dark, dot: isRunning ? "#4E9A3E" : null }), size, size);
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: png });
  }
  return img;
}

function refreshTray(): void {
  if (!tray) return;
  const label = running ? entryLabel(running) : "";
  const secs = running ? elapsedSeconds(running) : 0;
  if (process.platform === "darwin") tray.setTitle(running ? ` ${clock(secs)}` : "", { fontType: "monospacedDigit" });
  // Windows caps tooltips at 127 characters.
  tray.setToolTip((running ? `Mahaam — ${clock(secs)} · ${label}` : "Mahaam — no timer running").slice(0, 127));
}

function setRunning(r: TimeEntry | null): void {
  const changed = (r?.id ?? null) !== (running?.id ?? null);
  running = r;
  if (changed) {
    tray?.setImage(trayIcon(!!r));
    buildMenu();
  }
  if (r && !ticker) ticker = setInterval(refreshTray, 1000);
  if (!r && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  refreshTray();
}

function buildMenu(): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: "Open Mahaam", click: () => showPopover() },
    { type: "separator" },
  ];
  if (client?.workspace) {
    items.push(
      running
        ? { label: "Stop timer", accelerator: SHORTCUT, click: () => void toggleTimer() }
        : { label: "Start timer", accelerator: SHORTCUT, click: () => void toggleTimer() },
      { type: "separator" },
    );
  }
  items.push({ label: "Quit Mahaam", role: "quit" });
  const menu = Menu.buildFromTemplate(items);
  // Linux (AppIndicator) has no click events: the menu is the only way in.
  if (process.platform === "linux") tray.setContextMenu(menu);
  else tray.removeAllListeners("right-click").on("right-click", () => tray?.popUpContextMenu(menu));
}

/** The global shortcut: stop the running timer, or resume the last thing worked on (else the top Next-up item). */
async function toggleTimer(): Promise<void> {
  if (!client?.workspace) return showPopover();
  try {
    if (running) {
      const stopped = await client.stop();
      setRunning(null);
      notify("Timer stopped", `${entryLabel(stopped) || "Untitled"} · ${duration(elapsedSeconds(stopped))}`);
    } else {
      const last = (await client.entriesToday())[0];
      let started: TimeEntry;
      if (last) {
        started = (
          await client.start({
            ...(last.task_id ? { task: last.task_id } : last.project_id ? { project: last.project_id } : {}),
            description: last.description,
          })
        ).started;
      } else {
        const next = (await client.nextUp(1))[0];
        started = (next ? await client.startOn(next) : await client.start({})).started;
      }
      setRunning(started);
      notify("Timer started", entryLabel(started) || "Untitled");
    }
    send("mgy:live", { type: "timer.state", running } satisfies LiveEvent);
  } catch (e) {
    notify("Mahaam", e instanceof Error ? e.message : String(e));
  }
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

// ── popover window ───────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    ...POPOVER,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0B1429" : "#F0EBE1",
    title: "Mahaam",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  w.setMenu(null);
  if (process.platform === "darwin") w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Nothing may navigate this window or open new ones; links go to the default browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault();
  });
  w.on("blur", () => {
    if (!w.webContents.isDevToolsOpened() && !SHOW_ON_START) w.hide();
  });
  if (DEV_URL) void w.loadURL(DEV_URL);
  else void w.loadFile(join(__dirname, "../dist/index.html"));
  return w;
}

function positionWindow(w: BrowserWindow): void {
  const { width, height } = w.getBounds();
  const tb = tray?.getBounds();
  // Linux trays often report empty bounds: anchor to the pointer instead.
  const anchor = tb && tb.width > 0 ? tb : { ...screen.getCursorScreenPoint(), width: 0, height: 0 };
  const wa = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  let x = Math.round(anchor.x + anchor.width / 2 - width / 2);
  const below = anchor.y < wa.y + wa.height / 2; // menu bar / top panel → drop down; taskbar → pop up
  let y = below ? anchor.y + anchor.height + 4 : anchor.y - height - 4;
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - width - 4);
  y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - height - 4);
  w.setPosition(x, y, false);
}

function showPopover(): void {
  win ??= createWindow();
  positionWindow(win);
  win.show();
  win.focus();
}

function togglePopover(): void {
  if (win?.isVisible()) win.hide();
  else showPopover();
}

function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

// ── IPC (whitelisted; only from our own renderer) ────────────────────────

const API_METHODS = new Set([
  "workspaces",
  "running",
  "start",
  "startOn",
  "stop",
  "updateEntry",
  "logTime",
  "entriesToday",
  "nextUp",
  "notifications",
  "markAllRead",
  "projects",
  "createIssue",
]);

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error("untrusted sender");
    try {
      return await fn(...args);
    } catch (err) {
      // Keep the status so the renderer can tell a 401 from other failures.
      if (err instanceof ApiError) throw new Error(err.status === 401 ? `401:${err.message}` : err.message);
      throw err;
    }
  });
}

function registerIpc(): void {
  handle("mgy:config", () => ({
    defaultApiUrl: stored?.apiUrl ?? DEFAULT_URL,
    canRemember: store.canEncrypt(),
    shortcut: SHORTCUT.replace("CommandOrControl", process.platform === "darwin" ? "⌘" : "Ctrl"),
    autoLaunch: process.platform !== "linux",
    platform: process.platform,
  }));
  handle("mgy:session", () => sessionOut());
  handle("mgy:signIn", async (apiUrl: string, email: string, password: string, remember: boolean) => {
    const url = normalizeApiUrl(String(apiUrl ?? ""));
    const c = makeClient(url, null, null);
    // Assign state only after the login succeeds, so a typo cannot wipe a working session.
    const boot = new MahaamClient({ baseUrl: url, csrf: "cookie-header" });
    const jwt = await boot.login(String(email), String(password));
    // Prefer a personal access token over keeping the password: it is revocable from the server,
    // scoped to this device, and it does not expire, so nothing has to silently re-login. Older
    // self-hosted servers may not expose /api/auth/tokens, so fall back to the previous behaviour
    // rather than quietly breaking "keep me signed in".
    let token = jwt;
    let pat = false;
    if (remember && store.canEncrypt()) {
      try {
        token = await boot.createAccessToken(`Mahaam tray — ${hostname()}`);
        pat = true;
      } catch {
        token = jwt;
      }
    }
    stored = { apiUrl: url, email: String(email), workspace: stored?.email === email && stored.apiUrl === url ? stored.workspace : null };
    // The password is only kept when we could not get a PAT — see above.
    secrets = { token, ...(!pat && remember && store.canEncrypt() ? { password: String(password) } : {}) };
    c.setToken(token);
    client = c;
    if (stored.workspace) {
      // Still a member?
      const ws = await client.workspaces();
      stored.workspace = ws.find((w) => w.id === stored!.workspace!.id) ?? null;
    }
    client.setWorkspace(stored.workspace?.id ?? null);
    persist();
    startLive();
    buildMenu();
    return sessionOut();
  });
  handle("mgy:signOut", () => {
    stopLive();
    setRunning(null);
    client = null;
    if (stored) store.clear({ apiUrl: stored.apiUrl, email: stored.email });
    secrets = { token: null };
    buildMenu();
  });
  handle("mgy:selectWorkspace", (ws: Workspace) => {
    if (!client || !stored) throw new Error("not signed in");
    stored.workspace = { id: ws.id, slug: ws.slug, name: ws.name, role: ws.role, locale: ws.locale };
    client.setWorkspace(ws.id);
    persist();
    startLive();
    buildMenu();
  });
  handle("mgy:api", async (method: string, args: unknown[]) => {
    if (!API_METHODS.has(method)) throw new Error(`unknown method ${method}`);
    if (!client) throw new Error("401:sign in required");
    const fn = (client as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!;
    const call = Array.isArray(args) ? args : [];
    let out: unknown;
    try {
      out = await fn.apply(client, call);
    } catch (e) {
      // Only a network failure is queueable. A 4xx is the server refusing the content, and
      // replaying it forever would wedge everything behind it.
      const status = (e as { status?: number })?.status;
      if (method !== "logTime" || status !== 0) throw e;
      await logQueue.enqueue(`log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, call);
      throw new Error(queuedMessage(stored?.workspace?.locale === "ar" ? "ar" : "en"));
    }
    if (method === "start" || method === "startOn") setRunning((out as { started: TimeEntry }).started);
    if (method === "stop") setRunning(null);
    return out;
  });
  handle("mgy:timerChanged", (r: TimeEntry | null) => setRunning(r));
  handle("mgy:openUrl", (url: string) => openExternal(String(url)));
  handle("mgy:hide", () => win?.hide());
  handle("mgy:quit", () => app.quit());
  handle("mgy:autoLaunch:get", () => app.getLoginItemSettings().openAtLogin);
  handle("mgy:autoLaunch:set", (on: boolean) => app.setLoginItemSettings({ openAtLogin: !!on }));
}

// ── lifecycle ────────────────────────────────────────────────────────────

app.on("second-instance", () => showPopover());
app.on("window-all-closed", () => {
  /* a tray app keeps running with no windows */
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopLive();
});

void app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();
  if (process.platform === "win32") app.setAppUserModelId("com.fadymondy.mahaam.tray");
  registerIpc();
  restore();
  tray = new Tray(trayIcon(false));
  tray.on("click", togglePopover);
  nativeTheme.on("updated", () => tray?.setImage(trayIcon(!!running)));
  buildMenu();
  refreshTray();
  if (!globalShortcut.register(SHORTCUT, () => void toggleTimer())) console.warn(`[mahaam] shortcut ${SHORTCUT} is taken`);
  win = createWindow();
  if (SHOW_ON_START) win.once("ready-to-show", () => showPopover());
});

// Prompt copy for the idle watch. The tray's main process has no access to the panel's string
// table (that lives in the renderer bundle), so these two languages are kept here deliberately
// rather than plumbing i18n across the IPC boundary for one dialog.
function idleStrings(locale: "en" | "ar") {
  return locale === "ar"
    ? {
        title: "كنت بعيدًا",
        body: (m: number) => `يبدو أنك كنت بعيدًا لمدة ${m} دقيقة والمؤقّت يعمل. هل نحتسب هذا الوقت؟`,
        keep: "احتساب الوقت",
        discard: "خصم وقت الغياب",
      }
    : {
        title: "You were away",
        body: (m: number) => `The timer kept running while you were away for about ${m} minutes. Keep that time?`,
        keep: "Keep it",
        discard: "Discard the away time",
      };
}

/** Shown when a logged block could not reach the server and was kept for replay. */
function queuedMessage(locale: "en" | "ar"): string {
  return locale === "ar"
    ? "تعذّر الاتصال بالخادم — حُفظ الوقت وسيُرسل عند عودة الاتصال."
    : "Couldn't reach the server — saved, and it will sync when you're back online.";
}

/** Replay queued blocks. A 409 means the server already has it (no_overlap), so it is dropped. */
async function flushLogQueue(): Promise<void> {
  if (!client) return;
  const c = client;
  const out = await logQueue.flush(async (item) => {
    try {
      await (c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>).logTime!.apply(c, item.payload);
      return { kind: "ok" };
    } catch (e) {
      const status = (e as { status?: number })?.status ?? 0;
      return status === 0 ? { kind: "retry" } : classify(status);
    }
  });
  if (out.sent || out.duplicates || out.rejected) {
    console.error("[queue] replayed", out);
    setRunning(running);
  }
}
