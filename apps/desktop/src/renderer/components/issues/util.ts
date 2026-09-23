// Small, pure helpers the issue views share: ordering, due-date tone, estimates, clipboard, and the
// keyboard map lists and boards use (j/k, s/p/a, t, ⌘⇧C) — one window listener per view.
import { useEffect, useRef } from "react";

import type { Priority, Status, Task } from "../../../shared/types";
import { isTyping } from "@/lib/hotkeys";

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export const sortStatuses = (list: Status[] | null | undefined): Status[] => [...(list ?? [])].sort(byPosition);

/** A position strictly between two neighbours (either may be missing), like the server's. */
export function between(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

/** Urgent first, then by the most recent change. */
export const byPriorityThenUpdated = (a: Task, b: Task) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(b.updated_at) - Date.parse(a.updated_at);

/** How a due date should read: overdue (red), due within two days (amber), or just a date. */
export function dueTone(due: string | null | undefined, done: boolean): "overdue" | "soon" | null {
  if (!due || done) return null;
  const d = new Date(due);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
  const now = Date.now();
  if (end < now) return "overdue";
  if (end - now < 2 * 86400_000) return "soon";
  return null;
}

/** 150 → "2h 30m". */
export function fmtEstimate(min: number | null | undefined): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

/** "2h 30m", "1.5h", "90m", "90" (minutes) → minutes; "" → 0 (clears); nonsense → null. */
export function parseEstimate(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
}

/** The date part of an ISO timestamp in local time, for <input type="date">. */
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
  }
}

/** A menu, dialog or popover is up: list keys belong to it, not the list behind it. */
export function overlayOpen(): boolean {
  return !!document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]');
}

export const webPath = {
  issue: (key: string) => `/issues/${encodeURIComponent(key)}`,
  project: (id: string, view: "list" | "board" = "list") => `/projects/${encodeURIComponent(id)}/${view}`,
};

// ── keyboard ─────────────────────────────────────────────────────────────────

const isMac = () => window.mahaam?.platform === "darwin";

/** "mod+shift+c", "j", "arrowdown", "enter", "escape" — the event as a combo string. */
function comboOf(e: KeyboardEvent): string {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("mod");
  if (e.shiftKey && (mod || e.key.length > 1)) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join("+");
}

let lastKey: { key: string; at: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      // Remembered before anyone handles the key, so "g p" is still the shell's.
      const prev = lastKey;
      lastKey = { key: e.key.toLowerCase(), at: Date.now() };
      (e as KeyboardEvent & { mahaamPrev?: typeof prev }).mahaamPrev = prev;
    },
    true,
  );
}

/**
 * Keys for a list or board. Unlike useHotkey it leaves a key alone (no preventDefault) unless it
 * handles it, stands aside while a menu or dialog is open, and yields single letters to the shell's
 * "g x" sequences.
 */
export function useKeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const combo = comboOf(e);
      const fn = ref.current[combo];
      if (!fn) return;
      if (isTyping(e.target)) return;
      if (overlayOpen()) return;
      const prev = (e as KeyboardEvent & { mahaamPrev?: { key: string; at: number } | null }).mahaamPrev;
      if (combo.length === 1 && prev?.key === "g" && Date.now() - prev.at < 900) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/**
 * Whether a mousemove is the pointer really moving. Chromium also sends one when the content under
 * a still pointer changes (a keyboard scroll, a list re-sorting): those must not steal the focus.
 */
let lastPointer = { x: Number.NaN, y: Number.NaN };
export function pointerMoved(e: { screenX: number; screenY: number }): boolean {
  if (e.screenX === lastPointer.x && e.screenY === lastPointer.y) return false;
  lastPointer = { x: e.screenX, y: e.screenY };
  return true;
}

/** Keep a focused row or card on screen as the keyboard moves. */
export function revealFocused(container: HTMLElement | null, selector: string): void {
  const el = container?.querySelector<HTMLElement>(selector);
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
