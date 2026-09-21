// Storage + client shared by the popup, the options page and the service worker.
//
// The credential never touches disk. `chrome.storage.local` persists to the profile directory and
// is readable by anything that can read that directory; `chrome.storage.session` is memory-only
// and is cleared when the browser closes. So the token lives in session, and everything that is
// merely a preference — the API URL, the email to prefill, the chosen workspace — lives in local.
//
// What is held is a personal access token, not the 24h JWT. It is revocable from the server and
// listed under the user's own devices, so losing a browser is something you can do something
// about. The password is never stored at all.
import { DEFAULT_API_URL, MahaamClient, normalizeApiUrl, type TimeEntry, type Workspace } from "@mahaam/client";

export interface ExtState {
  apiUrl: string;
  email: string | null;
  token: string | null;
  workspace: Workspace | null;
}

export interface PendingPage {
  url: string;
  title?: string;
  selection?: string;
  mode: "issue" | "log";
}

export type ExtMessage = { type: "timer"; running: TimeEntry | null } | { type: "refresh" };

/** Preferences. Safe on disk: none of it authenticates anything. */
const LOCAL_KEYS = ["apiUrl", "email", "workspace"] as const;

/** The credential. Memory-only, so closing the browser ends the session. */
const SESSION_KEYS = ["token"] as const;

declare const __MAHAAM_API__: string; // set by vite.config.ts from MAHAAM_API_URL

/** In the Vite dev harness the popup talks to the dev server's /api proxy (same origin → CSRF cookie works). */
export const defaultApiUrl = (): string => (import.meta.env.DEV ? location.origin : __MAHAAM_API__ || DEFAULT_API_URL);

export async function loadState(): Promise<ExtState> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get([...LOCAL_KEYS]) as Promise<Partial<ExtState>>,
    chrome.storage.session.get([...SESSION_KEYS]) as Promise<Partial<ExtState>>,
  ]);
  return {
    apiUrl: local.apiUrl || defaultApiUrl(),
    email: local.email ?? null,
    token: session.token ?? null,
    workspace: local.workspace ?? null,
  };
}

/** Routes each key to the area it belongs in, so no caller has to remember which is which. */
export async function saveState(patch: Partial<ExtState>): Promise<void> {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    ((SESSION_KEYS as readonly string[]).includes(k) ? session : local)[k] = v;
  }
  await Promise.all([
    Object.keys(local).length ? chrome.storage.local.set(local) : null,
    Object.keys(session).length ? chrome.storage.session.set(session) : null,
  ]);
}

export function originPattern(apiUrl: string): string {
  const u = new URL(normalizeApiUrl(apiUrl));
  return `${u.protocol}//${u.hostname}/*`;
}

/**
 * Host permission for the API origin (resolves true at once when already granted, e.g. the default
 * host). Must run inside the sign-in click, before any other await, or Chrome refuses to prompt.
 */
export function requestOrigin(apiUrl: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(apiUrl)] });
}

export function makeClient(state: ExtState, onAuthRequired?: () => void): MahaamClient {
  return new MahaamClient({
    baseUrl: state.apiUrl,
    csrf: "browser",
    token: state.token,
    workspace: state.workspace?.id ?? null,
    onToken: (token) => void saveState({ token }),
    onAuthRequired,
  });
}

export async function takePendingPage(): Promise<PendingPage | null> {
  const { pending } = (await chrome.storage.session.get("pending")) as { pending?: PendingPage };
  if (pending) await chrome.storage.session.remove("pending");
  return pending ?? null;
}

/**
 * What this browser calls itself in the user's device list.
 *
 * Stable across sign-ins on purpose: replaceAccessToken matches on the name, so a stable one means
 * signing in again replaces this browser's token instead of leaving another row behind. It carries
 * no identifier — a device list should not be a fingerprint.
 */
export function deviceName(): string {
  const ua = globalThis.navigator?.userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : "Chrome";
  return `Mahaam extension — ${browser}`;
}
