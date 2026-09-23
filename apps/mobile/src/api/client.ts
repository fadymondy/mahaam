// The Mahaam API client used by both apps. Platform-free: storage, fetch and the CSRF cookie writer
// are injected, so the auth dance is unit-tested in Node (src/api/__tests__/client.test.ts).
//
// Auth, as the API's togo auth plugin wants it:
//   * POST /api/auth/login | /api/auth/register need a double-submit CSRF token: the same random value
//     as the `togo_csrf` cookie and the `X-CSRF-Token` header. Native sends the Cookie header itself;
//     the browser forbids that, so on web the cookie is written to document.cookie (same origin).
//   * The response carries a 24h JWT; every call sends `Authorization: Bearer <jwt>`, and workspace
//     calls add `X-Workspace-ID` (id or slug).
//   * The e-mail + password are kept in the secure store (Keychain / Keystore). On a 401, or when the
//     JWT is about to expire, the client signs in again silently — once, shared by every request in
//     flight — and replays the request. If that fails the session is cleared and onSessionLost fires.
// Idempotent requests retry on network errors and 502/503/504 with exponential backoff.

import type { User } from "./types";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Whether this store is backed by OS-level secret storage (Keychain / Keystore).
   * When false — the web build, which only has localStorage — the password is never
   * persisted, so silent re-login is disabled rather than leaving credentials where
   * any XSS could read them. Defaults to true for stores that do not say.
   */
  readonly secure?: boolean;
}

export interface ClientOptions {
  baseUrl: string;
  store: KeyValueStore;
  fetch?: typeof fetch;
  /** Web only: write the CSRF cookie (the Cookie header is forbidden in browsers). */
  setCsrfCookie?: (value: string) => void;
  onSessionLost?: () => void;
  sleep?: (ms: number) => Promise<void>;
  randomToken?: () => string;
  now?: () => number;
  retries?: number;
  /** Label for the personal access token minted at sign-in, so a user can tell devices apart. */
  deviceName?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() {
    return this.status === 0;
  }
}

/** The password was right and the account has two-factor on: finish with completeMfa(challenge). */
export class MfaRequired extends Error {
  constructor(readonly challenge: string) {
    super("two-factor code required");
    this.name = "MfaRequired";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  /** Send X-Workspace-ID (default true). */
  workspace?: boolean;
  signal?: AbortSignal;
  /** Return the raw text instead of JSON. */
  text?: boolean;
}

const K = { token: "mahaam.token", creds: "mahaam.creds", user: "mahaam.user", ws: "mahaam.workspace" } as const;

export function randomCsrf(): string {
  const bytes = new Uint8Array(24);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The `exp` claim of a JWT in ms, or null. */
export function jwtExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json =
      typeof atob === "function" ? atob(b64) : (globalThis as any).Buffer.from(b64, "base64").toString("binary");
    const exp = JSON.parse(json).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, any>;
    if (typeof b.detail === "string" && b.detail) return b.detail;
    if (typeof b.error === "string" && b.error) return b.error;
    if (Array.isArray(b.errors) && b.errors[0]?.message) return String(b.errors[0].message);
    if (typeof b.title === "string" && b.title) return b.title;
  }
  if (typeof body === "string" && body.trim() && body.length < 200) return body.trim();
  return `HTTP ${status}`;
}

const RETRYABLE = new Set([502, 503, 504]);
const EXPIRY_SKEW_MS = 60_000;

export class MahaamClient {
  token: string | null = null;
  user: User | null = null;
  workspace: string | null = null;

  private relogin: Promise<boolean> | null = null;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly o: ClientOptions) {
    this.f = o.fetch ?? ((input, init) => fetch(input as RequestInfo, init));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  get baseUrl() {
    return this.o.baseUrl.replace(/\/$/, "");
  }

  /** Load the saved session. Returns true when a token or saved credentials exist. */
  async restore(): Promise<boolean> {
    const [token, user, ws, creds] = await Promise.all([
      this.o.store.get(K.token),
      this.o.store.get(K.user),
      this.o.store.get(K.ws),
      this.o.store.get(K.creds),
    ]);
    this.token = token;
    this.user = user ? (JSON.parse(user) as User) : null;
    this.workspace = ws;
    return !!(token || creds);
  }

  async setWorkspace(ws: string | null) {
    this.workspace = ws;
    if (ws) await this.o.store.set(K.ws, ws);
    else await this.o.store.del(K.ws);
  }

  /** Credentials held in memory between a password that asked for 2FA and the code. */
  private pendingMfa: { email: string; password: string } | null = null;

  /**
   * Sign in. An account with two-factor on answers a right password with 401
   * {code: "mfa_required", challenge} and no session; that surfaces as MfaRequired, and
   * completeMfa() finishes the sign-in with the code (or a recovery code).
   */
  async login(email: string, password: string): Promise<User> {
    let out: { token: string; user?: User };
    try {
      out = await this.authPost("/api/auth/login", { email, password });
    } catch (e) {
      const d = e instanceof ApiError ? (e.body as { code?: string; challenge?: string } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 401 && d?.code === "mfa_required" && d.challenge) {
        this.pendingMfa = { email, password };
        throw new MfaRequired(d.challenge);
      }
      throw e;
    }
    await this.saveSession(out, { email, password });
    await this.upgradeToAccessToken(this.o.deviceName ?? "Mahaam mobile");
    return this.user!;
  }

  /** The second step of a 2FA sign-in: the authenticator code or a one-time recovery code. */
  async completeMfa(challenge: string, answer: { code: string } | { recovery_code: string }): Promise<User> {
    const out = await this.authPost("/api/auth/2fa/challenge", { challenge, ...answer });
    // pendingMfa is null after a passwordless first step (Apple): nothing to keep for re-login.
    await this.saveSession(out, this.pendingMfa);
    this.pendingMfa = null;
    await this.upgradeToAccessToken(this.o.deviceName ?? "Mahaam mobile");
    return this.user!;
  }

  /**
   * Sign in with Apple (iOS): the identity token Apple gave the app and the RAW nonce whose SHA-256
   * the app passed to Apple (the server checks token.nonce == sha256hex(raw)). Apple sends the name
   * only the first time. A new Apple ID becomes a passwordless account; one with two-factor on
   * answers mfa_required like a password sign-in.
   */
  async appleSignIn(input: { identity_token: string; nonce: string; name?: { given?: string; family?: string }; locale?: string }): Promise<User> {
    let out: { token: string; user?: User; access_token?: string };
    try {
      out = (await this.authPost("/api/auth/apple", { ...input, device_name: this.o.deviceName ?? "Mahaam mobile" })) as typeof out;
    } catch (e) {
      const d = e instanceof ApiError ? (e.body as { code?: string; challenge?: string } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 401 && d?.code === "mfa_required" && d.challenge) {
        this.pendingMfa = null;
        throw new MfaRequired(d.challenge);
      }
      throw e;
    }
    await this.saveSession(out, null);
    if (out.access_token) await this.adoptToken(out.access_token);
    else await this.upgradeToAccessToken(this.o.deviceName ?? "Mahaam mobile");
    return this.user!;
  }

  /**
   * The end of a sign-in done in the system browser (Google, GitHub…): the one-time code the web's
   * app-signin page sent back to mahaam://auth/callback, exchanged with the PKCE verifier for this
   * device's access token (POST /api/auth/app/token), then who it belongs to (GET /api/auth/me).
   */
  async exchangeAppCode(code: string, verifier: string, redirectUri: string): Promise<User> {
    const out = await this.request<{ token: string; email?: string }>("/api/auth/app/token", {
      method: "POST",
      body: { code, code_verifier: verifier, redirect_uri: redirectUri },
      workspace: false,
    });
    await this.adoptToken(out.token);
    const me = await this.request<{ id?: string; ID?: string; email?: string; Email?: string; user?: User }>("/api/auth/me", { workspace: false });
    const id = me.user?.id ?? me.id ?? me.ID ?? "";
    const email = me.user?.email ?? me.email ?? me.Email ?? out.email ?? "";
    this.user = { id, email };
    await this.o.store.set(K.user, JSON.stringify(this.user));
    return this.user;
  }

  private async adoptToken(token: string) {
    this.token = token;
    await Promise.all([this.o.store.set(K.token, token), this.o.store.del(K.creds)]);
  }

  /** An unauthenticated POST that needs the CSRF double-submit (forgot / reset password). */
  async publicPost<T = unknown>(path: string, body: unknown): Promise<T> {
    return (await this.csrfPost(path, body)) as T;
  }

  /** Sign out: revoke this device's access token on the server, then forget it locally. */
  async signOut() {
    if (this.token) await this.request("/api/me/token", { method: "DELETE" }).catch(() => undefined);
    await this.logout();
  }

  async register(name: string, email: string, password: string): Promise<User> {
    const out = await this.authPost("/api/auth/register", { name, email, password });
    await this.saveSession(out, { email, password });
    await this.upgradeToAccessToken(this.o.deviceName ?? "Mahaam mobile");
    return this.user!;
  }

  /**
   * POST /api/auth/tokens → a personal access token (`togo_pat_…`), returned once.
   *
   * Held instead of the password: revocable from the server, scoped to this device and
   * non-expiring, so nothing needs the credentials to silently re-login.
   *
   * Note "sign out everywhere" permanently rejects existing PATs — the server's revocation
   * check looks for a JWT `iat` a PAT has not got — so a 401 means sign in again, not a bug.
   */
  async createAccessToken(name: string): Promise<string> {
    const out = await this.request<{ token: string }>("/api/auth/tokens", { method: "POST", body: { name, abilities: [] } });
    return out.token;
  }

  /** Swap the freshly issued JWT for a PAT, so the password never has to be kept. */
  private async upgradeToAccessToken(deviceName: string): Promise<boolean> {
    try {
      const pat = await this.createAccessToken(deviceName);
      this.token = pat;
      await Promise.all([this.o.store.set(K.token, pat), this.o.store.del(K.creds)]);
      return true;
    } catch {
      // An older self-hosted server may not expose the endpoint; keep the JWT path.
      return false;
    }
  }
  async logout() {
    this.token = null;
    this.user = null;
    this.workspace = null;
    await Promise.all([this.o.store.del(K.token), this.o.store.del(K.creds), this.o.store.del(K.user), this.o.store.del(K.ws)]);
  }

  /** `creds` null: a passwordless sign-in (Apple, a browser handoff) — nothing to re-login with. */
  private async saveSession(out: { token: string; user?: { id: string; email: string } }, creds: { email: string; password: string } | null) {
    this.token = out.token;
    this.user = out.user ? { id: out.user.id, email: out.user.email } : this.user;
    const canKeepSecrets = this.o.store.secure !== false;
    await Promise.all([
      this.o.store.set(K.token, out.token),
      // Only where the OS can protect it. Without this the plaintext password lands in
      // localStorage on the web build. reauthenticate() simply returns false instead.
      canKeepSecrets && creds ? this.o.store.set(K.creds, JSON.stringify(creds)) : this.o.store.del(K.creds),
      this.user ? this.o.store.set(K.user, JSON.stringify(this.user)) : Promise.resolve(),
    ]);
  }

  private async authPost(path: string, body: unknown): Promise<{ token: string; user?: User }> {
    const data = await this.csrfPost(path, body);
    const out = data as { token?: string; user?: User };
    if (!out?.token) throw new ApiError(200, "no token in response", data);
    return out as { token: string; user?: User };
  }

  private async csrfPost(path: string, body: unknown): Promise<unknown> {
    const csrf = (this.o.randomToken ?? randomCsrf)();
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf };
    if (this.o.setCsrfCookie) this.o.setCsrfCookie(csrf);
    else headers.Cookie = `togo_csrf=${csrf}`;
    let res: Response;
    try {
      res = await this.f(this.baseUrl + path, { method: "POST", headers, body: JSON.stringify(body), credentials: "include" });
    } catch (e) {
      throw new ApiError(0, (e as Error)?.message || "network error");
    }
    const data = await readBody(res);
    if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status), data, retryAfter(res));
    return data;
  }

  /** Sign in again with the stored credentials. Concurrent callers share one attempt. */
  reauthenticate(): Promise<boolean> {
    if (!this.relogin) {
      this.relogin = (async () => {
        const raw = await this.o.store.get(K.creds);
        if (!raw) {
          // A personal access token has no password behind it (login dropped it). A 401 on a PAT
          // means it was revoked, expired or belongs to another server: the session is gone, and
          // saying so beats leaving every screen on "unauthorized" with nowhere to go.
          if (this.token) {
            await this.logout();
            this.o.onSessionLost?.();
          }
          return false;
        }
        const { email, password } = JSON.parse(raw) as { email: string; password: string };
        try {
          const out = await this.authPost("/api/auth/login", { email, password });
          await this.saveSession(out, { email, password });
          return true;
        } catch (e) {
          // Wrong password now (changed elsewhere) → the session is gone. Network / rate limit → keep
          // the credentials and let the caller surface the error.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 422)) {
            await this.logout();
            this.o.onSessionLost?.();
            return false;
          }
          throw e;
        }
      })().finally(() => {
        this.relogin = null;
      });
    }
    return this.relogin;
  }

  private tokenExpiring(): boolean {
    if (!this.token) return true;
    const exp = jwtExpiry(this.token);
    return exp !== null && exp - EXPIRY_SKEW_MS <= this.now();
  }

  private headers(o: RequestOptions): Record<string, string> {
    const h: Record<string, string> = { Accept: o.text ? "text/html" : "application/json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (o.workspace !== false && this.workspace) h["X-Workspace-ID"] = this.workspace;
    if (o.body !== undefined && !o.form) h["Content-Type"] = "application/json";
    return h;
  }

  async request<T>(path: string, o: RequestOptions = {}): Promise<T> {
    const method = o.method ?? "GET";
    const idempotent = method === "GET" || method === "PUT" || method === "DELETE";
    const retries = idempotent ? (this.o.retries ?? 2) : 0;
    if (this.tokenExpiring() && (await this.o.store.get(K.creds))) await this.reauthenticate();

    let reauthed = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.f(this.baseUrl + path, {
          method,
          headers: this.headers(o),
          body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
          signal: o.signal,
        });
      } catch (e) {
        if ((e as Error)?.name === "AbortError") throw e;
        if (attempt < retries) {
          await this.sleep(400 * 2 ** attempt);
          continue;
        }
        throw new ApiError(0, (e as Error)?.message || "network error");
      }
      if (res.status === 401 && !reauthed) {
        reauthed = true;
        if (await this.reauthenticate()) continue;
      }
      if (RETRYABLE.has(res.status) && attempt < retries) {
        await this.sleep(400 * 2 ** attempt);
        continue;
      }
      const ra = retryAfter(res);
      if (res.status === 429 && idempotent && attempt < retries && ra !== undefined && ra <= 5) {
        await this.sleep(ra * 1000);
        continue;
      }
      if (o.text) {
        const txt = await res.text();
        if (!res.ok) throw new ApiError(res.status, errorMessage(safeJson(txt), res.status), txt, ra);
        return txt as T;
      }
      const data = await readBody(res);
      if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status), data, ra);
      return data as T;
    }
  }

  get<T>(path: string, o?: Omit<RequestOptions, "method" | "body">) {
    return this.request<T>(path, { ...o, method: "GET" });
  }
  post<T>(path: string, body?: unknown, o?: Omit<RequestOptions, "method" | "body">) {
    return this.request<T>(path, { ...o, method: "POST", body: body ?? {} });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "PATCH", body });
  }
  del<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PUT", body: body ?? {} });
  }

  /** Like get, but a 404 / 405 answers null — for endpoints that may not exist on this server yet. */
  async optional<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
      throw e;
    }
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const t = await res.text();
  return t ? safeJson(t) : null;
}

function retryAfter(res: Response): number | undefined {
  const v = res.headers?.get?.("Retry-After");
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
