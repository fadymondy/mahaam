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
