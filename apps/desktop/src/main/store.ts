// What the app remembers between launches. The token lives only in `secret`, encrypted by the OS
// keychain (safeStorage: Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux).
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Workspace } from "@mahaam/client";

export interface Stored {
  apiUrl: string;
  email: string;
  workspace: Workspace | null;
  /** safeStorage-encrypted token, base64. */
  secret?: string;
}

export interface Prefs {
  theme: "system" | "light" | "dark";
  locale: "en" | "ar";
  /** OS notifications for inbox events. */
  notify: boolean;
  /** Ask to trim time spent away from the computer. */
  idle: boolean;
  /** Sidebar collapsed. */
  sidebar: "open" | "collapsed";
}

export const DEFAULT_PREFS: Prefs = { theme: "system", locale: "en", notify: true, idle: true, sidebar: "open" };

const file = (name: string) => join(app.getPath("userData"), name);

/** Linux without a keyring falls back to a fixed key ("basic_text"), which is not a keychain. */
export function canEncrypt(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false;
  return true;
}

function readJson<T>(name: string): T | null {
  try {
    return existsSync(file(name)) ? (JSON.parse(readFileSync(file(name), "utf8")) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(dirname(file(name)), { recursive: true });
  writeFileSync(file(name), JSON.stringify(value, null, 2), { mode: 0o600 });
}

export function loadSession(): { stored: Stored; token: string | null } | null {
  const stored = readJson<Stored>("session.json");
  if (!stored) return null;
  let token: string | null = null;
  if (stored.secret && canEncrypt()) {
    try {
      token = safeStorage.decryptString(Buffer.from(stored.secret, "base64"));
    } catch {
      token = null;
    }
  }
  return { stored, token };
}

export function saveSession(stored: Omit<Stored, "secret">, token: string | null): void {
  const out: Stored = { ...stored };
  // Without a keychain the token is not written at all: the person signs in each launch.
  if (token && canEncrypt()) out.secret = safeStorage.encryptString(token).toString("base64");
  writeJson("session.json", out);
}

export function clearSession(keep?: { apiUrl: string; email: string }): void {
  if (keep) writeJson("session.json", { ...keep, workspace: null });
  else rmSync(file("session.json"), { force: true });
}

export function loadPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...(readJson<Partial<Prefs>>("prefs.json") ?? {}) };
}

export function savePrefs(p: Prefs): void {
  writeJson("prefs.json", p);
}
