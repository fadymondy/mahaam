// The renderer's side of main/native.ts: the operating system's own menus, alerts and share sheet,
// instead of HTML drawn to look like them.
import type { NativeMenuItem } from "../../main/native";
import type { PaletteMode } from "../../main/surfaces";
import { ApiError } from "./bridge";

export type { NativeMenuItem };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const out = (await window.mahaam.invoke(channel, ...args)) as { ok: true; value: T } | { ok: false; status: number; message: string };
  if (!out.ok) throw new ApiError(out.status, out.message);
  return out.value;
}

/**
 * A native menu. `at` is the element it drops down from (placed under it, aligned to its start edge
 * — the end edge in RTL), a point in window CSS px, or nothing for "at the pointer" (right-click).
 * Resolves with the chosen item's id, or null when dismissed.
 */
export function nativeMenu(items: NativeMenuItem[], at?: Element | { x: number; y: number } | null): Promise<string | null> {
  let point: { x: number; y: number } | undefined;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    point = { x: rtl ? r.right : r.left, y: r.bottom + 4 };
  } else if (at) point = at;
  return call<string | null>("native:menu", { items, ...(point ?? {}) });
}

const icons = new Map<string, Promise<string | undefined>>();

/** A CSS colour (a palette variable, color-mix…) as the canvas can take it. */
function cssColor(value: string): string {
  const el = document.createElement("span");
  el.style.color = value;
  document.body.appendChild(el);
  const out = getComputedStyle(el).color;
  el.remove();
  return out;
}

/**
 * A project's image for a native menu row (32px for 16pt at 2×): its avatar, or the coloured tile
 * with its initial that the app draws (ProjectMark). Cached per project and look.
 */
export function projectMenuImage(p: { id: string; name: string; color?: string | null; avatar?: string | null }, colors: { soft: string; solid: string }): Promise<string | undefined> {
  const key = `${p.id}|${p.name}|${p.color}|${p.avatar?.length ?? 0}|${document.documentElement.classList.contains("dark")}`;
  let hit = icons.get(key);
  if (!hit) {
    hit = (async () => {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const g = canvas.getContext("2d");
      if (!g) return undefined;
      g.beginPath();
      g.roundRect(0, 0, size, size, 8);
      g.clip();
      if (p.avatar) {
        const img = new Image();
        img.src = p.avatar;
        await img.decode();
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      } else {
        g.fillStyle = cssColor(colors.soft);
        g.fillRect(0, 0, size, size);
        g.fillStyle = cssColor(colors.solid);
        g.font = `600 18px Inter, -apple-system, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(p.name.slice(0, 1).toUpperCase(), size / 2, size / 2 + 1);
      }
      return canvas.toDataURL("image/png");
    })().catch(() => undefined);
    icons.set(key, hit);
  }
  return hit;
}

/** A native alert (a sheet on macOS). Resolves true when confirmed. */
export function nativeConfirm(o: { message: string; detail?: string; confirm: string; cancel: string; destructive?: boolean }): Promise<boolean> {
  return call<boolean>("native:confirm", o).catch(() => false);
}

/** The macOS Share menu (Mail, Messages, AirDrop, Notes…) for a link. */
export const nativeShare = (url: string, title?: string) => call<void>("native:share", url, title).catch(() => undefined);

/** An issue in its own document window. */
export const openIssueWindow = (key: string) => call<void>("window:issue", key).catch(() => undefined);

/** The Spotlight panel: search (⌘K), a new issue (⌘N, optionally in a project/status) or a timer. */
export const openPalette = (mode: PaletteMode = "search", preset?: { project?: string | null; status?: string | null }) =>
  call<void>("surface:palette", mode, preset).catch(() => undefined);
