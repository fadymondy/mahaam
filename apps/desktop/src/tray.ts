// The menu-bar timer. It draws what the console page reports (DesktopWorkspaceSync in
// web/components/desktop): the page already holds the live stream, so a timer started on the
// phone, the web or the extension shows up here within a second, with no second sign-in. The
// clock is ticked here from started_at — the server owns the time, every client recomputes.
import { app, Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions } from "electron";
import { rasterMark } from "@mahaam/client/brand";
import { encodePng } from "@mahaam/client/brand/png";

import { trayStrings, type Locale } from "./strings";

export type TimerState = {
  running: { what: string; where: string; started_at: string } | null;
  recent: { label: string; sub: string; body: Record<string, unknown> }[];
  workspace: string;
};

type Handlers = {
  show: () => void;
  command: (type: string, extra?: Record<string, unknown>) => void;
  locale: () => Locale;
};

let tray: Tray | null = null;
let state: TimerState | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let handlers: Handlers;
let menu: Menu | null = null;

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const elapsed = (startedAt: string) => (Date.now() - Date.parse(startedAt)) / 1000;

function icon(running: boolean): Electron.NativeImage {
  const mac = process.platform === "darwin";
  const dark = mac ? nativeTheme.shouldUseDarkColors : nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = (mac ? 18 : 16) * scale;
    const png = encodePng(rasterMark(size, { dark, dot: running ? "#4E9A3E" : null }), size, size);
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: png });
  }
  return img;
}

function tick(): void {
  if (!tray) return;
  const s = trayStrings(handlers.locale());
  const r = state?.running;
  const secs = r ? elapsed(r.started_at) : 0;
  if (process.platform === "darwin") tray.setTitle(r ? ` ${clock(secs)}` : "", { fontType: "monospacedDigit" });
  // Windows caps tooltips at 127 characters.
  tray.setToolTip((r ? `Mahaam — ${clock(secs)} · ${r.what}` : `Mahaam — ${s.idle}`).slice(0, 127));
}

function buildMenu(): void {
  if (!tray) return;
  const s = trayStrings(handlers.locale());
  const r = state?.running;
  const items: MenuItemConstructorOptions[] = [];
  if (!state) {
    items.push({ label: s.signedOut, enabled: false });
  } else if (r) {
    items.push(
      { label: r.what, enabled: false },
      ...(r.where ? [{ label: r.where, enabled: false }] : []),
      { label: s.stop, accelerator: "CmdOrCtrl+Alt+Shift+M", click: () => handlers.command("timer-stop") },
    );
  } else {
    items.push(
      { label: s.idle, enabled: false },
      {
        label: s.start,
        click: () => {
          handlers.show();
          handlers.command("palette");
        },
      },
    );
  }
  if (state?.recent.length) {
    items.push({ type: "separator" }, { label: s.resume, enabled: false });
    for (const e of state.recent) {
      items.push({
        label: e.sub ? `${e.label} — ${e.sub}` : e.label,
        click: () => handlers.command("timer-start", { body: e.body }),
      });
    }
  }
  items.push(
    { type: "separator" },
    { label: s.open, click: handlers.show },
    { label: s.quit, role: "quit" },
  );
  menu = Menu.buildFromTemplate(items);
  // One menu on every platform; Linux (AppIndicator) has no click events, so it must be the
  // context menu there, and on macOS/Windows a click opens it too.
  tray.setContextMenu(menu);
}

export function createTray(h: Handlers): void {
  handlers = h;
  tray = new Tray(icon(false));
  nativeTheme.on("updated", () => tray?.setImage(icon(!!state?.running)));
  buildMenu();
  tick();
}

export function setTimerState(next: TimerState | null): void {
  const was = !!state?.running;
  state = next;
  if (was !== !!next?.running) tray?.setImage(icon(!!next?.running));
  buildMenu();
  if (next?.running && !ticker) ticker = setInterval(tick, 1000);
  if (!next?.running && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  tick();
}

/** The global shortcut: stop the running timer, or resume the last thing worked on. */
export function toggleTimer(): void {
  if (!state) return handlers.show();
  if (state.running) handlers.command("timer-stop");
  else if (state.recent[0]) handlers.command("timer-start", { body: state.recent[0].body });
  else {
    handlers.show();
    handlers.command("palette");
  }
}

export function refreshTrayLocale(): void {
  buildMenu();
  tick();
}

/** For the e2e (MAHAAM_E2E=1): what the menu bar shows, and a click on a menu item by label. */
export const trayProbe = {
  title: () => tray?.getTitle() ?? "",
  items: () => (menu?.items ?? []).map((i) => i.label).filter(Boolean),
  click: (label: string) => menu?.items.find((i) => i.label === label)?.click(),
};
app.on("before-quit", () => ticker && clearInterval(ticker));
