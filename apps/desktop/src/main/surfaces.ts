// The app's windows besides the main one — each a real OS surface, not a view inside the window:
//
//   popover   the menu-bar companion (left-click the tray): the timer, quick start, recent work,
//             your next issues. Vibrant, borderless, hides when you click elsewhere — like the
//             system's own menu-bar extras.
//   palette   the global quick palette (⌘⇧Space from any app, like Spotlight): jump to an issue,
//             create one, start a timer — without switching to Mahaam.
//   settings  Settings in its own window (⌘,), the way macOS apps do it.
//
// All of them load the same renderer bundle with ?surface=…, run sandboxed with the same preload,
// and get the same live events as the main window (main.ts broadcasts).
import { app, BrowserWindow, screen, type Rectangle, type WebPreferences } from "electron";
import { join } from "node:path";

export type Surface = "main" | "popover" | "palette" | "settings";

const IS_MAC = process.platform === "darwin";

let devUrl: string | undefined;
let openExternal: (url: string) => void = () => {};
let ground: () => string = () => "#f0ebe1";
let edge: (w: BrowserWindow) => void = () => {};
const windows = new Map<Exclude<Surface, "main">, BrowserWindow>();
const shownAt = new WeakMap<BrowserWindow, number>();

export function initSurfaces(opts: { devUrl?: string; openExternal: (url: string) => void; ground: () => string; edge: (w: BrowserWindow) => void }): void {
  devUrl = opts.devUrl;
  edge = opts.edge;
  openExternal = opts.openExternal;
  ground = opts.ground;
}

export function webPreferences(): WebPreferences {
  return {
    preload: join(__dirname, "preload.cjs"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: true,
  };
}

/** Our renderer, with the surface in the query. Anything else it tries to open goes to the browser. */
export function load(w: BrowserWindow, surface: Surface, query: Record<string, string> = {}): void {
  const q = new URLSearchParams({ surface, ...query });
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (devUrl ? url.startsWith(devUrl) : url.startsWith("file://")) return;
    e.preventDefault();
    openExternal(url);
  });
  if (devUrl) void w.loadURL(`${devUrl}?${q}`);
  else void w.loadFile(join(__dirname, "renderer", "index.html"), { search: q.toString() });
}

export const surfaceWindow = (s: Exclude<Surface, "main">) => {
  const w = windows.get(s);
  return w && !w.isDestroyed() ? w : null;
};

/** A borderless panel that hides when it loses focus (not in the first moments: activation can bounce). */
function panel(surface: "popover" | "palette", size: { width: number; height: number }, material: "popover" | "hud"): BrowserWindow {
  const w = new BrowserWindow({
    ...size,
    show: false,
    frame: false,
    resizable: false,
    movable: surface === "palette",
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    ...(IS_MAC
      ? { vibrancy: material, visualEffectState: "active" as const, backgroundColor: "#00000000", roundedCorners: true }
      : { backgroundColor: ground() }),
    webPreferences: webPreferences(),
  });
  windows.set(surface, w);
  w.on("blur", () => {
    if (!w.webContents.isDevToolsOpened() && Date.now() - (shownAt.get(w) ?? 0) > 300 && process.env.MAHAAM_E2E !== "1") w.hide();
  });
  w.on("closed", () => windows.delete(surface));
  load(w, surface);
  return w;
}

// ── popover ──────────────────────────────────────────────────────────────────────────────────

const POPOVER = { width: 380, height: 580 };

/** Built early, hidden, so the first click on the tray opens it instantly. */
export function prewarmPopover(): void {
  if (!surfaceWindow("popover")) panel("popover", POPOVER, "popover");
}

function place(w: BrowserWindow, anchor: Rectangle | null): void {
  const [width, height] = w.getSize() as [number, number];
  const point = anchor && anchor.width > 0 ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 } : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  let x = Math.round(point.x - width / 2);
  let y: number;
  if (anchor && anchor.width > 0) {
    // Menu bar / top panel: drop down. The Windows taskbar at the bottom: rise above it.
    y = anchor.y < display.bounds.y + display.bounds.height / 2 ? anchor.y + anchor.height + 6 : anchor.y - height - 6;
  } else {
    x = area.x + area.width - width - 8;
    y = area.y + 8;
  }
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - width - 8);
  y = Math.min(Math.max(y, area.y + 4), area.y + area.height - height - 4);
  w.setPosition(x, y, false);
}

let paletteMode: "search" | "create" = "search";

/** The palette keeps its window exactly as tall as what it shows (from the renderer). */
export function resizeSurface(w: BrowserWindow, height: number): void {
  if (surfaceWindow("palette") !== w) return;
  const h = Math.round(Math.min(Math.max(height, 64), 560));
  const [width] = w.getSize() as [number, number];
  if (w.getSize()[1] !== h) w.setSize(width, h, false);
}

function present(w: BrowserWindow): void {
  // Opened from the tray or a global shortcut while another app is in front: take the keyboard
  // first, or the panel would blur — and hide — the instant it appears.
  if (IS_MAC) app.focus({ steal: true });
  shownAt.set(w, Date.now());
  w.show();
  w.focus();
  w.webContents.send("surface:shown", surfaceWindow("palette") === w ? { mode: paletteMode } : {});
}

export function togglePopover(anchor: Rectangle | null): void {
  const w = surfaceWindow("popover") ?? panel("popover", POPOVER, "popover");
  if (w.isVisible()) {
    w.hide();
    return;
  }
  place(w, anchor);
  if (w.webContents.isLoading()) w.once("ready-to-show", () => present(w));
  else present(w);
}

// ── palette ──────────────────────────────────────────────────────────────────────────────────

const PALETTE_WIDTH = 680;

/** `mode`: "search" (⌘⇧Space) or "create" (⌥⌘N, straight into a new issue). */
export function showPalette(mode: "search" | "create" = "search"): void {
  // "popover", not "hud": hud is a dark material in every appearance, which showed as a black
  // edge around the palette in light mode. popover follows the app's light/dark.
  const w = surfaceWindow("palette") ?? panel("palette", { width: PALETTE_WIDTH, height: 420 }, "popover");
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  w.setPosition(Math.round(area.x + (area.width - PALETTE_WIDTH) / 2), Math.round(area.y + area.height * 0.2), false);
  paletteMode = mode;
  // Over full-screen apps too, like Spotlight.
  if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (w.webContents.isLoading()) w.once("ready-to-show", () => present(w));
  else present(w);
}

// ── settings ─────────────────────────────────────────────────────────────────────────────────

export function showSettings(section?: string): void {
  const existing = surfaceWindow("settings");
  if (existing) {
    existing.show();
    existing.focus();
    if (section) existing.webContents.send("command", { type: "settings", section });
    return;
  }
  const w = new BrowserWindow({
    width: 820,
    height: 620,
    minWidth: 680,
    minHeight: 480,
    show: false,
    title: "Mahaam",
    maximizable: false,
    fullscreenable: false,
    backgroundColor: ground(),
    ...(IS_MAC ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } } : { autoHideMenuBar: true }),
    webPreferences: webPreferences(),
  });
  windows.set("settings", w);
  edge(w);
  w.once("ready-to-show", () => w.show());
  w.on("closed", () => windows.delete("settings"));
  load(w, "settings", section ? { section } : {});
}

/** Theme changed: the solid-ground windows repaint their native background. */
export function retintSurfaces(): void {
  surfaceWindow("settings")?.setBackgroundColor(ground());
  if (!IS_MAC) {
    surfaceWindow("popover")?.setBackgroundColor(ground());
    surfaceWindow("palette")?.setBackgroundColor(ground());
  }
}
