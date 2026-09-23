// The menu-bar timer. Driven by the main process's own services: the running entry comes from the
// live stream (timer.state / started / stopped), so a timer started on the phone, the web or the
// extension shows here within a second, with or without a window open. The clock ticks here from
// started_at — the server owns the time, every client recomputes.
import { Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions } from "electron";
import { rasterMark } from "@mahaam/client/brand";
import { encodePng } from "@mahaam/client/brand/png";

import type { StartInput, TimeEntry } from "../shared/types";
import { trayStrings, type Locale } from "./strings";

export interface TrayDeps {
  /** Left click: the popover (macOS, Windows). Right click, and Linux, get the menu. */
  onClick: (bounds: Electron.Rectangle) => void;
  locale: () => Locale;
  signedIn: () => boolean;
  show: () => void;
  timerPalette: () => void;
  stop: () => Promise<unknown>;
  start: (input: StartInput) => Promise<unknown>;
}

export interface Recent {
  label: string;
  sub: string;
  input: StartInput;
}

let tray: Tray | null = null;
let deps: TrayDeps;
let running: TimeEntry | null = null;
let recent: Recent[] = [];
let ticker: ReturnType<typeof setInterval> | null = null;
let menu: Menu | null = null;

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const entryLabel = (e: Pick<TimeEntry, "description" | "task_title" | "project_name">) =>
  e.description || e.task_title || e.project_name || "";

const elapsed = (e: TimeEntry) => (Date.now() - Date.parse(e.started_at)) / 1000;

/**
 * The menu-bar / tray icon, light or dark to match where it sits — not the app's own theme (Mahaam
 * in Dark on a light menu bar must still draw a dark icon).
 *
 * macOS: a template image (black + alpha). The system tints it for the menu bar's actual look —
 * light, dark, tinted by the wallpaper, and inverted while its menu is open. The running dot is a
 * shape, so it survives the tint (the clock beside it says the rest).
 * Windows/Linux: the brand colours for the taskbar's light or dark, redrawn when that changes.
 */
function icon(on: boolean): Electron.NativeImage {
  const mac = process.platform === "darwin";
  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = (mac ? 18 : 16) * scale;
    const px = mac ? rasterMark(size, { mono: "#000000", dot: on ? "#000000" : null }) : rasterMark(size, { dark, dot: on ? "#4E9A3E" : null });
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: encodePng(px, size, size) });
  }
  if (mac) img.setTemplateImage(true);
  return img;
}

function tick(): void {
  if (!tray) return;
  const s = trayStrings(deps.locale());
  const secs = running ? elapsed(running) : 0;
  if (process.platform === "darwin") tray.setTitle(running ? ` ${clock(secs)}` : "", { fontType: "monospacedDigit" });
  tray.setToolTip((running ? `Mahaam — ${clock(secs)} · ${entryLabel(running) || s.untitled}` : `Mahaam — ${s.idle}`).slice(0, 127));
}

function build(): void {
  if (!tray) return;
  const s = trayStrings(deps.locale());
  const items: MenuItemConstructorOptions[] = [];
  if (!deps.signedIn()) {
    items.push({ label: s.signedOut, enabled: false });
  } else if (running) {
    const where = [running.task_key, running.project_name].filter(Boolean).join(" · ");
    items.push(
      { label: entryLabel(running) || s.untitled, enabled: false },
      ...(where ? [{ label: where, enabled: false }] : []),
      { label: s.stop, accelerator: "CmdOrCtrl+Alt+Shift+M", click: () => void deps.stop() },
    );
  } else {
    items.push({ label: s.idle, enabled: false }, { label: s.start, click: deps.timerPalette });
  }
  if (deps.signedIn() && recent.length) {
    items.push({ type: "separator" }, { label: s.resume, enabled: false });
    for (const r of recent) items.push({ label: r.sub ? `${r.label} — ${r.sub}` : r.label, click: () => void deps.start(r.input) });
  }
  items.push({ type: "separator" }, { label: s.open, click: deps.show }, { label: s.quit, role: "quit" });
  menu = Menu.buildFromTemplate(items);
  tray.setContextMenu(menu);
}

export function createTray(d: TrayDeps): void {
  deps = d;
  tray = new Tray(icon(false));
  nativeTheme.on("updated", () => tray?.setImage(icon(!!running)));
  if (process.platform !== "linux") {
    tray.on("click", (_e, bounds) => d.onClick(bounds));
    tray.on("right-click", () => menu && tray?.popUpContextMenu(menu));
  }
  build();
  tick();
}

export function setRunning(next: TimeEntry | null): void {
  const changed = (next?.id ?? null) !== (running?.id ?? null) || entryLabel(next ?? ({} as TimeEntry)) !== entryLabel(running ?? ({} as TimeEntry));
  const was = !!running;
  running = next;
  if (was !== !!next) tray?.setImage(icon(!!next));
  if (changed) build();
  if (next && !ticker) ticker = setInterval(tick, 1000);
  if (!next && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  tick();
}

export const getRunning = () => running;

/** Recent finished work, newest first, one row per task/project/description. */
export function setRecent(entries: TimeEntry[], untitled: string): void {
  const seen = new Set<string>();
  recent = [];
  for (const e of entries) {
    if (!e.ended_at) continue;
    const key = `${e.task_id ?? ""}|${e.project_id ?? ""}|${e.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({
      label: entryLabel(e) || untitled,
      sub: [e.task_key, e.project_name].filter(Boolean).join(" · "),
      input: {
        ...(e.task_id ? { task: e.task_id } : e.project_id ? { project: e.project_id } : {}),
        ...(e.description ? { description: e.description } : {}),
        billable: e.billable,
      },
    });
    if (recent.length === 5) break;
  }
  build();
}

export const getRecent = () => recent;

export function refreshTray(): void {
  build();
  tick();
}

/** For the e2e (MAHAAM_E2E=1): what the menu bar shows, and a click on a menu item by label. */
export const trayProbe = {
  title: () => tray?.getTitle() ?? "",
  items: () => (menu?.items ?? []).map((i) => i.label).filter(Boolean),
  click: (label: string) => menu?.items.find((i) => i.label === label)?.click(),
  /** A left click on the menu-bar icon (opens the popover on macOS and Windows). */
  open: () => tray?.emit("click", {}, tray.getBounds()),
  bounds: () => tray?.getBounds() ?? null,
  template: () => icon(!!running).isTemplateImage(),
};
