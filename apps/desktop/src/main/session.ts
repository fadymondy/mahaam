// The signed-in account, owned by the main process. The renderer never sees the token: it asks for
// data over IPC (api.ts) and gets data back.
//
// Signing in mints a personal access token for this device (revocable in Settings → Devices on the
// web, and on the next sign-in here), so the password is never stored. Google/GitHub accounts have
// no password; they sign in on the Mahaam sign-in page in a separate window, and the token is
// minted from that page's session cookie.
import { BrowserWindow, session as electronSession } from "electron";
import { hostname } from "node:os";
import {
  ApiError,
  isMfaRequired,
  MahaamClient,
  normalizeApiUrl,
  type Identity,
  type Workspace,
} from "@mahaam/client";

import * as store from "./store";

export interface SessionOut {
  apiUrl: string;
  email: string;
  userId: string;
  workspace: Workspace | null;
  workspaces: Workspace[];
}

type Listener = (s: SessionOut | null, reason: "signed-in" | "signed-out" | "workspace" | "expired") => void;

const AUTH_PARTITION = "persist:mahaam-auth";

let client: MahaamClient | null = null;
let stored: Omit<store.Stored, "secret"> | null = null;
let token: string | null = null;
let me: Identity | null = null;
let workspaces: Workspace[] = [];
const listeners = new Set<Listener>();

export const defaultApiUrl = (override?: string) => normalizeApiUrl(override || process.env.MAHAAM_API_URL || "");

const deviceName = () =>
  `Mahaam for ${process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows" : "Linux"} — ${hostname()}`;

export function onSession(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason: Parameters<Listener>[1]): void {
  const s = current();
  for (const fn of listeners) fn(s, reason);
}

function persist(): void {
  if (stored) store.saveSession(stored, token);
}

function makeClient(apiUrl: string, t: string | null, workspace: string | null): MahaamClient {
  return new MahaamClient({
    baseUrl: apiUrl,
    csrf: "cookie-header",
    token: t,
    workspace,
    onToken: (next) => {
      token = next;
      persist();
    },
    onAuthRequired: () => expire(),
  });
}

function expire(): void {
  if (!client) return;
  client = null;
  token = null;
  me = null;
  if (stored) store.clearSession({ apiUrl: stored.apiUrl, email: stored.email });
  emit("expired");
}

export function current(): SessionOut | null {
  if (!client || !stored || !me) return null;
  return { apiUrl: stored.apiUrl, email: stored.email, userId: me.id, workspace: stored.workspace, workspaces };
}

export const api = () => client;
export const lastEmail = () => stored?.email ?? "";
export const apiUrl = () => stored?.apiUrl ?? defaultApiUrl();

/** Picks the remembered workspace if still a member, else the first one. */
async function settle(c: MahaamClient): Promise<void> {
  me = await c.me();
  workspaces = await c.workspaces();
  const keep = stored?.workspace && workspaces.find((w) => w.id === stored!.workspace!.id);
  const ws = keep || workspaces[0] || null;
  stored = { apiUrl: stored!.apiUrl, email: me.email || stored!.email, workspace: ws ? pick(ws) : null };
  c.setWorkspace(ws?.id ?? null);
}

const pick = (w: Workspace): Workspace => ({ id: w.id, slug: w.slug, name: w.name, role: w.role, locale: w.locale });

/** On launch: resume the stored session, if the token still works. */
export async function restore(): Promise<void> {
  const s = store.loadSession();
  if (!s) return;
  const { secret: _drop, ...rest } = s.stored;
  stored = rest;
  if (!s.token) return;
  token = s.token;
  const c = makeClient(stored.apiUrl, token, stored.workspace?.id ?? null);
  try {
    await settle(c);
    client = c;
    persist();
  } catch (e) {
    // Offline at launch is not signed out: keep the session and let the stream reconnect.
    if (e instanceof ApiError && e.status === 401) {
      store.clearSession({ apiUrl: stored.apiUrl, email: stored.email });
      token = null;
      return;
    }
    client = c;
    me = { id: "", email: stored.email };
  }
}

export type SignInResult = { ok: true; session: SessionOut } | { ok: false; mfa: true };

export async function signIn(
  apiUrlIn: string,
  email: string,
  password: string,
  second?: { code?: string; recovery_code?: string },
): Promise<SignInResult> {
  const url = normalizeApiUrl(apiUrlIn);
  const boot = new MahaamClient({ baseUrl: url, csrf: "cookie-header" });
  let jwt: string;
  try {
    jwt = await boot.login(email.trim(), password, second);
  } catch (e) {
    if (isMfaRequired(e)) return { ok: false, mfa: true };
    throw e;
  }
  let t = jwt;
  try {
    t = await boot.replaceAccessToken(deviceName());
  } catch {
    // An older server without /api/auth/tokens: the session JWT still works until it expires.
  }
  return adopt(url, email.trim(), t);
}

async function adopt(url: string, email: string, t: string): Promise<SignInResult> {
  const c = makeClient(url, t, null);
  stored = { apiUrl: url, email, workspace: stored?.apiUrl === url && stored.email === email ? stored.workspace : null };
  token = t;
  await settle(c);
  client = c;
  persist();
  emit("signed-in");
  return { ok: true, session: current()! };
}

/**
 * Google, GitHub or Apple: the Mahaam sign-in page in its own window, on its own cookie jar.
 * Once it lands in the console, the device token is minted from that session and the window
 * closes. Resolves null if the person closes the window first.
 */
export function signInWithBrowser(apiUrlIn: string, parent: BrowserWindow | null, locale: string): Promise<SignInResult | null> {
  const url = normalizeApiUrl(apiUrlIn);
  const ses = electronSession.fromPartition(AUTH_PARTITION);
  // A clean jar every time: this window is for signing in, not for browsing as someone.
  return ses.clearStorageData().then(
    () =>
      new Promise<SignInResult | null>((resolve, reject) => {
        const win = new BrowserWindow({
          width: 520,
          height: 720,
          parent: parent ?? undefined,
          modal: process.platform !== "darwin" && !!parent,
          title: "Mahaam",
          autoHideMenuBar: true,
          webPreferences: { partition: AUTH_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        // Google refuses sign-in inside anything that announces itself as Electron.
        win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/\S+/, "").replace(/ @mahaam\/desktop\/\S+/, ""));
        let done = false;
        const finish = (v: SignInResult | null, err?: unknown) => {
          if (done) return;
          done = true;
          if (!win.isDestroyed()) win.close();
          if (err) reject(err);
          else resolve(v);
        };
        const check = async (target: string) => {
          if (done) return;
          let path = "";
          try {
            const u = new URL(target);
            if (u.origin !== new URL(url).origin) return;
            path = u.pathname;
          } catch {
            return;
          }
          if (!/^\/(en|ar)\/(workspaces|w\/)/.test(path)) return;
          try {
            const boot = new MahaamClient({
              baseUrl: url,
              csrf: "browser",
              fetch: ((input: RequestInfo | URL, init?: RequestInit) => ses.fetch(String(input), { ...init, credentials: "include" })) as typeof fetch,
            });
            const out = await boot.tokenFromBrowserSession(deviceName());
            await ses.clearStorageData();
            finish(await adopt(url, out.email, out.token));
          } catch (e) {
            finish(null, e);
          }
        };
        win.webContents.on("did-navigate", (_e, u) => void check(u));
        win.webContents.on("did-navigate-in-page", (_e, u) => void check(u));
        win.on("closed", () => finish(null));
        void win.loadURL(`${url}/${locale === "ar" ? "ar" : "en"}/login`);
      }),
  );
}

export async function signOut(): Promise<void> {
  const c = client;
  client = null;
  me = null;
  const keep = stored ? { apiUrl: stored.apiUrl, email: stored.email } : undefined;
  // Revoke this device's token so it stops working everywhere, not just here.
  if (c) {
    try {
      const mine = (await c.accessTokens()).filter((t) => t.name === deviceName());
      for (const t of mine) await c.revokeAccessToken(t.id);
    } catch {
      /* offline or an older server: signing out locally still happens */
    }
  }
  token = null;
  store.clearSession(keep);
  emit("signed-out");
}

export async function selectWorkspace(id: string): Promise<SessionOut> {
  if (!client || !stored) throw new ApiError(401, "sign in required");
  workspaces = await client.workspaces();
  const ws = workspaces.find((w) => w.id === id || w.slug === id);
  if (!ws) throw new ApiError(404, "workspace not found");
  stored.workspace = pick(ws);
  client.setWorkspace(ws.id);
  persist();
  emit("workspace");
  return current()!;
}
