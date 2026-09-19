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

  async login(email: string, password: string): Promise<User> {
    const out = await this.authPost("/api/auth/login", { email, password });
    await this.saveSession(out, { email, password });
    return this.user!;
  }

  async register(name: string, email: string, password: string): Promise<User> {
    const out = await this.authPost("/api/auth/register", { name, email, password });
    await this.saveSession(out, { email, password });
    return this.user!;
  }

  async logout() {
    this.token = null;
    this.user = null;
    this.workspace = null;
    await Promise.all([this.o.store.del(K.token), this.o.store.del(K.creds), this.o.store.del(K.user), this.o.store.del(K.ws)]);
  }

  private async saveSession(out: { token: string; user?: { id: string; email: string } }, creds: { email: string; password: string }) {
    this.token = out.token;
    this.user = out.user ? { id: out.user.id, email: out.user.email } : this.user;
    await Promise.all([
      this.o.store.set(K.token, out.token),
      this.o.store.set(K.creds, JSON.stringify(creds)),
      this.user ? this.o.store.set(K.user, JSON.stringify(this.user)) : Promise.resolve(),
    ]);
  }

  private async authPost(path: string, body: unknown): Promise<{ token: string; user?: User }> {
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
    const out = data as { token?: string; user?: User };
    if (!out?.token) throw new ApiError(res.status, "no token in response", data);
    return out as { token: string; user?: User };
  }

  /** Sign in again with the stored credentials. Concurrent callers share one attempt. */
  reauthenticate(): Promise<boolean> {
    if (!this.relogin) {
      this.relogin = (async () => {
        const raw = await this.o.store.get(K.creds);
        if (!raw) return false;
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
