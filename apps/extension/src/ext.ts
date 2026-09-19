// Storage + client shared by the popup, the options page and the service worker.
// Only the JWT is stored (chrome.storage.local) — never the password. A 401 clears it and the
// popup asks to sign in again.
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

const KEYS = ["apiUrl", "email", "token", "workspace"] as const;

declare const __MAHAAM_API__: string; // set by vite.config.ts from MAHAAM_API_URL

/** In the Vite dev harness the popup talks to the dev server's /api proxy (same origin → CSRF cookie works). */
export const defaultApiUrl = (): string => (import.meta.env.DEV ? location.origin : __MAHAAM_API__ || DEFAULT_API_URL);

export async function loadState(): Promise<ExtState> {
  const s = (await chrome.storage.local.get([...KEYS])) as Partial<ExtState>;
  return { apiUrl: s.apiUrl || defaultApiUrl(), email: s.email ?? null, token: s.token ?? null, workspace: s.workspace ?? null };
}

export async function saveState(patch: Partial<ExtState>): Promise<void> {
  await chrome.storage.local.set(patch);
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
