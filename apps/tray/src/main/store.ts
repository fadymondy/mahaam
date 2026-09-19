import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Workspace } from "@mahaam/client";

/** What the tray remembers between launches. Secrets live only in `secret`, encrypted by the OS keychain. */
export interface Stored {
  apiUrl: string;
  email: string;
  workspace: Workspace | null;
  /** safeStorage-encrypted JSON of Secrets, base64. */
  secret?: string;
}

export interface Secrets {
  token: string | null;
  password?: string;
}

const file = () => join(app.getPath("userData"), "session.json");

/**
 * safeStorage is the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on
 * Linux). On Linux without a keyring it falls back to a hard-coded key ("basic_text"), which is
 * not a keychain, so nothing secret is written there.
 */
export function canEncrypt(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false;
  return true;
}

export function load(): { stored: Stored; secrets: Secrets } | null {
  try {
    if (!existsSync(file())) return null;
    const stored = JSON.parse(readFileSync(file(), "utf8")) as Stored;
    let secrets: Secrets = { token: null };
    if (stored.secret && canEncrypt()) {
      try {
        secrets = JSON.parse(safeStorage.decryptString(Buffer.from(stored.secret, "base64"))) as Secrets;
      } catch {
        secrets = { token: null };
      }
    }
    return { stored, secrets };
  } catch {
    return null;
  }
}

export function save(stored: Omit<Stored, "secret">, secrets: Secrets | null): void {
  const out: Stored = { ...stored };
  if (secrets && canEncrypt()) out.secret = safeStorage.encryptString(JSON.stringify(secrets)).toString("base64");
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(out, null, 2), { mode: 0o600 });
}

export function clear(keepEmail?: { apiUrl: string; email: string }): void {
  if (keepEmail) save({ ...keepEmail, workspace: null }, null);
  else rmSync(file(), { force: true });
}
