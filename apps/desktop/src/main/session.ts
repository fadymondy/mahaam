// The signed-in account, owned by the main process. The renderer never sees the token: it asks for
// data over IPC (api.ts) and gets data back.
//
// Signing in mints a personal access token for this device (revocable in Settings → Devices on the
// web, and on the next sign-in here), so the password is never stored. Google/GitHub accounts have
// no password; they sign in on the web in the system browser, which redirects back here, and the token is
// minted through a one-time code bound to this process's PKCE verifier (signInWithBrowser).
import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { basename } from "node:path";
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

let client: MahaamClient | null = null;
let stored: Omit<store.Stored, "secret"> | null = null;
let token: string | null = null;
let me: Identity | null = null;
let workspaces: Workspace[] = [];
const listeners = new Set<Listener>();

export const defaultApiUrl = (override?: string) => normalizeApiUrl(override || process.env.MAHAAM_API_URL || "");

// One token per device, by name: signing in replaces this name's earlier token, signing out
// revokes it. A separate profile (MAHAAM_USER_DATA: the e2e, or a second account on one machine)
// is a separate device, or signing in one would sign the other out.
export const deviceName = () =>
  `Mahaam for ${process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows" : "Linux"} — ${hostname()}` +
  (process.env.MAHAAM_USER_DATA ? ` (${basename(process.env.MAHAAM_USER_DATA)})` : "");

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
    resettle(c);
  }
}

/**
 * The server couldn't be reached at launch, so the session is kept but doesn't know who you are
 * yet (me.id is ""). Everything scoped to "me" (My issues, the timer's owner) waits on that id,
 * so without this the app stayed in that state until it was restarted: My issues showed its
 * loader for ever. Keep trying, backing off to a minute, until the server answers; then tell the
 * windows, which refetch with the real id.
 */
function resettle(c: MahaamClient, delay = 5_000): void {
  setTimeout(async () => {
    if (client !== c || (me && me.id)) return; // signed out, replaced, or already settled
    try {
      await settle(c);
      persist();
      emit("workspace");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        expire();
        return;
      }
      resettle(c, Math.min(delay * 2, 60_000));
    }
  }, delay);
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
 * Google, GitHub or Apple — in the person's own browser, never an embedded one (RFC 8252). The
 * app listens on a loopback port, opens <web>/<locale>/app-signin in the default browser with a
 * PKCE challenge, and waits: the person signs in on the web as usual, confirms, and the browser is
 * redirected to http://127.0.0.1:<port>/callback with a one-time code. The code and the verifier
 * (which never left this process) are traded for this device's token
 * (internal/account/appsignin.go). Resolves null if cancelled or after ten minutes.
 */
let pendingBrowser: { cancel: () => void } | null = null;

export function cancelBrowserSignIn(): void {
  pendingBrowser?.cancel();
}

/** The sign-in providers the server has on (GET /api/auth/methods), for the sign-in screen's buttons. */
export async function authMethods(apiUrlIn: string): Promise<{ name: string; label: string; url: string }[]> {
  try {
    const r = await fetch(`${normalizeApiUrl(apiUrlIn)}/api/auth/methods`, { headers: { Accept: "application/json" } });
    const d = (await r.json()) as { methods?: { name?: string; label?: string; url?: string; type?: string }[] | null };
    return (d.methods ?? [])
      .filter((m) => m?.type === "oauth" && typeof m.name === "string" && typeof m.url === "string" && m.url.startsWith("/api/"))
      .map((m) => ({ name: m.name!, label: m.label ?? m.name!, url: m.url! }));
  } catch {
    return [];
  }
}

/**
 * `provider`: a method url from authMethods (e.g. /api/auth/oauth/google) — the browser goes
 * straight to that provider and comes back to the app-signin page; without one it opens the web's
 * own sign-in page first.
 */
export function signInWithBrowser(apiUrlIn: string, locale: string, onReturn: () => void, provider?: string): Promise<SignInResult | null> {
  pendingBrowser?.cancel();
  const url = normalizeApiUrl(apiUrlIn);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  return new Promise<SignInResult | null>((resolve, reject) => {
    let settled = false;
    const server = createServer();
    const finish = (v: SignInResult | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingBrowser = null;
      server.close();
      if (err) reject(err);
      else resolve(v);
    };
    const timer = setTimeout(() => finish(null), 10 * 60_000);
    pendingBrowser = { cancel: () => finish(null) };

    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      // The state ties this redirect to the sign-in this app started; anything else is ignored.
      if (!code || u.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page(locale, false));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page(locale, true));
      onReturn();
      const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
      void (async () => {
        const r = await fetch(`${url}/api/auth/app/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }),
        });
        const body = (await r.json().catch(() => ({}))) as { token?: string; email?: string; detail?: string };
        if (!r.ok || !body.token) throw new ApiError(r.status, body.detail || `sign-in failed (HTTP ${r.status})`, body);
        return adopt(url, body.email ?? "", body.token);
      })().then(
        (v) => finish(v),
        (e) => finish(null, e),
      );
    });

    // 127.0.0.1 only, on a port the OS picks: nothing off this machine can reach it.
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const q = new URLSearchParams({
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        device: deviceName(),
      });
      const handoff = `/${locale === "ar" ? "ar" : "en"}/app-signin?${q}`;
      const direct = typeof provider === "string" && /^\/api\/auth\/oauth\/[a-z0-9_-]+$/.test(provider);
      void shell.openExternal(direct ? `${url}${provider}?next=${encodeURIComponent(handoff)}` : `${url}${handoff}`);
    });
    server.on("error", (e) => finish(null, e));
  });
}

/** What the browser tab shows after the redirect: done, go back to the app. */
function page(locale: string, ok: boolean): string {
  const ar = locale === "ar";
  const title = ok ? (ar ? "تمّ تسجيل الدخول" : "You're signed in") : ar ? "تعذّر تسجيل الدخول" : "Sign-in didn't complete";
  const body = ok
    ? ar
      ? "عد إلى تطبيق مهام. يمكنك إغلاق هذه الصفحة."
      : "Go back to the Mahaam app. You can close this tab."
    : ar
      ? "ابدأ تسجيل الدخول من جديد من تطبيق مهام."
      : "Start signing in again from the Mahaam app.";
  return `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>Mahaam</title>
<style>:root{color-scheme:light dark;--bg:#f0ebe1;--fg:#0e1a3c;--muted:#6e6551;--line:#ded5c4;--card:#f7f4ec}
@media(prefers-color-scheme:dark){:root{--bg:#0b1429;--fg:#f0ebe1;--muted:#8a97b8;--line:#25355c;--card:#0e1a3c}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.6 Inter,-apple-system,system-ui,sans-serif}
main{border:1px solid var(--line);background:var(--card);padding:32px 40px;max-width:380px;text-align:center}
h1{font-size:18px;font-weight:500;margin:14px 0 6px}p{color:var(--muted);margin:0}</style></head>
<body><main><svg width="36" height="36" viewBox="0 0 100 100" aria-hidden="true"><rect x="29" y="29" width="21" height="21" fill="#8C3FB5"/><rect x="71" y="29" width="21" height="21" fill="#C9A227"/><rect x="8" y="50" width="21" height="21" fill="#8C3FB5"/><rect x="50" y="50" width="21" height="21" fill="#8C3FB5"/></svg>
<h1>${title}</h1><p>${body}</p></main></body></html>`;
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
