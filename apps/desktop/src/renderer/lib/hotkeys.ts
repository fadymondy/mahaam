// Keyboard-first, like Linear: single keys (C, J/K, S, P, A), sequences ("g i"), and modifiers
// ("mod+enter" is ⌘ on macOS, Ctrl elsewhere). Ignored while typing in a field unless `inInputs`.
import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

const isMac = () => window.mahaam?.platform === "darwin";

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || !!el.closest?.("[role=dialog] [cmdk-input]");
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const want = { mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (want.mod !== mod || want.shift !== e.shiftKey || want.alt !== e.altKey) return false;
  if (!want.mod && (e.metaKey || e.ctrlKey)) return false;
  const k = e.key.toLowerCase();
  return k === key || (key === "enter" && k === "enter") || (key === "esc" && k === "escape") || (key === "space" && k === " ");
}

let pending: { first: string; at: number } | null = null;

/**
 * useHotkey("c", open) · useHotkey("g i", goInbox) · useHotkey("mod+enter", submit, { inInputs: true })
 * Handlers are read through a ref, so passing an inline function does not re-bind.
 */
export function useHotkey(combo: string | string[], handler: Handler, opts: { enabled?: boolean; inInputs?: boolean } = {}): void {
  const ref = useRef(handler);
  ref.current = handler;
  const combos = Array.isArray(combo) ? combo : [combo];
  const key = combos.join("|");
  const enabled = opts.enabled ?? true;
  const inInputs = opts.inInputs ?? false;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!inInputs && isTyping(e.target)) return;
      for (const c of key.split("|")) {
        const seq = c.split(" ");
        if (seq.length === 2) {
          if (pending && Date.now() - pending.at < 900 && pending.first === seq[0] && matches(seq[1]!, e)) {
            pending = null;
            e.preventDefault();
            ref.current(e);
            return;
          }
          continue;
        }
        if (matches(c, e)) {
          e.preventDefault();
          ref.current(e);
          return;
        }
      }
      // Remember a possible first key of a sequence.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) pending = { first: e.key.toLowerCase(), at: Date.now() };
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, enabled, inInputs]);
}

/** The label for a shortcut in this OS's notation: "mod+k" → "⌘K" / "Ctrl+K". */
export function kbd(combo: string): string {
  const mac = isMac();
  return combo
    .split(" ")
    .map((step) =>
      step
        .split("+")
        .map((p) => (p === "mod" ? (mac ? "⌘" : "Ctrl") : p === "shift" ? (mac ? "⇧" : "Shift") : p === "alt" ? (mac ? "⌥" : "Alt") : p === "enter" ? "↵" : p.length === 1 ? p.toUpperCase() : p))
        .join(mac ? "" : "+"),
    )
    .join(" ");
}
