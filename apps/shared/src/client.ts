import { readSse, SseParser } from "./sse";
import type {
  AccessToken,
  CreateIssueInput,
  Credentials,
  EntryPatch,
  Identity,
  Inbox,
  Issue,
  IssueDetail,
  LiveEvent,
  LogInput,
  NextItem,
  Project,
  StartInput,
  Task,
  TimeEntry,
  TimerChange,
  Workspace,
} from "./types";

export const DEFAULT_API_URL = "https://console.mahaam.app";

/**
 * How the login/register POSTs satisfy the auth plugin's double-submit CSRF check.
 * - "cookie-header": send a random value as both `Cookie: togo_csrf=` and `X-CSRF-Token` (Node, Electron main).
 * - "browser": `Cookie` is a forbidden header in browsers, so fetch GET /api/auth/csrf with credentials
 *   (the API sets the cookie) and echo the returned token (extension pages, the Vite dev harness).
 */
export type CsrfMode = "cookie-header" | "browser";

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  csrf?: CsrfMode;
  token?: string | null;
  workspace?: string | null;
  /** Stored credentials for a silent re-login when the 24h JWT expires. Omit to never store a password. */
  credentials?: () => Promise<Credentials | null> | Credentials | null;
  /** Called with every new token (persist it) and with null when it is rejected. */
  onToken?: (token: string | null) => void;
  /** Called when a request is unauthorised and no silent re-login was possible. */
  onAuthRequired?: () => void;
  /** Clock, for tests. */
  now?: () => number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOpts {
  body?: unknown;
  query?: Query;
  /** Send X-Workspace-ID (default true for /api/w/*). */
  workspace?: boolean;
  signal?: AbortSignal;
  /** Internal: already retried after a re-login. */
  retried?: boolean;
}

function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The `exp` claim of a JWT in ms, or null. The signature is not checked (the API does that). */
export function tokenExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Normalises a user-typed API URL: adds https://, drops trailing slashes and a trailing /api. */
export function normalizeApiUrl(input: string): string {
  let u = input.trim();
  if (!u) return DEFAULT_API_URL;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const url = new URL(u);
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/api")) path = path.slice(0, -4);
  return url.origin + path;
}

/** Local calendar date (YYYY-MM-DD) of a Date. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class MahaamClient {
  readonly baseUrl: string;
  private readonly f: typeof fetch;
  private readonly csrf: CsrfMode;
  private readonly opts: ClientOptions;
  private relogin: Promise<boolean> | null = null;
  private meCache: Identity | null = null;
  token: string | null;
  workspace: string | null;

  constructor(opts: ClientOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.csrf = opts.csrf ?? "cookie-header";
    this.token = opts.token ?? null;
    this.workspace = opts.workspace ?? null;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  setToken(token: string | null): void {
    if (token !== this.token) this.meCache = null;
    this.token = token;
    this.opts.onToken?.(token);
  }

  setWorkspace(ws: string | null): void {
    this.workspace = ws;
  }

  // ── auth ────────────────────────────────────────────────────────────────

  private async csrfHeaders(): Promise<{ headers: Record<string, string>; credentials?: RequestCredentials }> {
    if (this.csrf === "cookie-header") {
      const v = randomHex();
      return { headers: { Cookie: `togo_csrf=${v}`, "X-CSRF-Token": v } };
    }
    const res = await this.f(this.baseUrl + "/api/auth/csrf", { credentials: "include" });
    if (!res.ok) throw new ApiError(res.status, "could not get a CSRF token");
    const { csrf_token } = (await res.json()) as { csrf_token: string };
    return { headers: { "X-CSRF-Token": csrf_token }, credentials: "include" };
  }

  private async credentialPost(path: string, body: unknown): Promise<string> {
    const c = await this.csrfHeaders();
    const res = await this.f(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...c.headers },
      body: JSON.stringify(body),
      ...(c.credentials ? { credentials: c.credentials } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !data.token) {
      const msg = data.error ?? `HTTP ${res.status}`;
      throw new ApiError(res.status, res.status === 401 ? "invalid credentials" : msg, data);
    }
    this.setToken(data.token);
    return data.token;
  }

  /** POST /api/auth/login → stores and returns the JWT. */
  login(email: string, password: string): Promise<string> {
    return this.credentialPost("/api/auth/login", { email, password });
  }

  /** POST /api/auth/register → stores and returns the JWT. */
  register(email: string, password: string, name?: string): Promise<string> {
    return this.credentialPost("/api/auth/register", { email, password, ...(name ? { name } : {}) });
  }

  logout(): void {
    this.setToken(null);
  }

  /**
   * POST /api/auth/tokens → a personal access token (`togo_pat_…`), returned by the server once.
   *
   * Hold this instead of the user's password. It is revocable per device and it never exposes the
   * real credential. Because it is not a JWT, tokenExpiry() returns null for it and the silent
   * re-login path simply stops firing — which is the point.
   *
   * It is **not** scoped: it carries the user's own access in full. The server refuses a request
   * that asks for `abilities` rather than issue a narrow-looking token that is not narrow, so
   * there is no parameter for them here. MCP tokens (`mgy_`) are the scoped token system.
   *
   * Caveat worth knowing: "sign out everywhere" permanently rejects existing PATs, because the
   * server's revocation check looks for a JWT `iat` that a PAT does not carry. Callers should
   * treat a 401 as "sign in again and mint a new one", not as a fatal error.
   */
  async createAccessToken(name: string): Promise<string> {
    const out = await this.request<{ token: string }>("POST", "/api/auth/tokens", { body: { name } });
    return out.token;
  }

  /** The user's own tokens — one row per device. The token itself is never returned again. */
  accessTokens(): Promise<AccessToken[]> {
    return this.request<AccessToken[]>("GET", "/api/auth/tokens");
  }

  /** Revokes one by id. Revoking someone else's is silently a no-op, not an error. */
  async revokeAccessToken(id: string): Promise<void> {
    await this.request("DELETE", `/api/auth/tokens/${encodeURIComponent(id)}`);
  }

  /**
   * Mints a token for this device, replacing any earlier one of the same name.
   *
   * Without the replace, every sign-in leaves another row behind — after a month the user's device
   * list is thirty identical entries and revoking "the browser" means revoking all of them.
   *
   * The old ids are collected *before* minting, because the new token has the same name and would
   * otherwise be revoked along with them. If minting fails there is nothing to clean up; if the
   * cleanup fails the caller still has a working token.
   */
  async replaceAccessToken(name: string): Promise<string> {
    let stale: string[] = [];
    try {
      stale = (await this.accessTokens()).filter((t) => t.name === name).map((t) => t.id);
    } catch {
      // An older server may not list them. Minting still works.
    }
    const token = await this.createAccessToken(name);
    for (const id of stale) {
      try {
        await this.revokeAccessToken(id);
      } catch {
        // A stale row is untidy, not dangerous. Never fail a sign-in over it.
      }
    }
    return token;
  }

  /** One shared re-login at a time, from the stored credentials. */
  private tryRelogin(): Promise<boolean> {
    if (!this.opts.credentials) return Promise.resolve(false);
    this.relogin ??= (async () => {
      try {
        const c = await this.opts.credentials!();
        if (!c) return false;
        await this.login(c.email, c.password);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (this.relogin = null), 0);
      }
    })();
    return this.relogin;
  }

  /** Re-login ahead of time when the token expires within a minute (and credentials are stored). */
  private async ensureFresh(): Promise<void> {
    if (!this.token || !this.opts.credentials) return;
    const exp = tokenExpiry(this.token);
    if (exp !== null && exp - this.now() < 60_000) await this.tryRelogin();
  }

  // ── transport ───────────────────────────────────────────────────────────

  private url(path: string, query?: Query): string {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private headers(path: string, opts: RequestOpts, json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (json) h["Content-Type"] = "application/json";
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    const wantWs = opts.workspace ?? path.startsWith("/api/w/");
    if (wantWs) {
      if (!this.workspace) throw new ApiError(0, "no workspace selected");
      h["X-Workspace-ID"] = this.workspace;
    }
    return h;
  }

  /** Sends one request; on 401 re-logs in once from stored credentials and retries. */
  async request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    await this.ensureFresh();
    if (!this.token) {
      if (!(await this.tryRelogin())) {
        this.opts.onAuthRequired?.();
        throw new ApiError(401, "sign in required");
      }
    }
    const json = opts.body !== undefined;
    const res = await this.f(this.url(path, opts.query), {
      method,
      headers: this.headers(path, opts, json),
      ...(json ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (res.status === 401) {
      if (!opts.retried && (await this.tryRelogin())) return this.request<T>(method, path, { ...opts, retried: true });
      this.setToken(null);
      this.opts.onAuthRequired?.();
      throw new ApiError(401, "session expired — sign in again");
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const d = data as { detail?: string; title?: string; error?: string; errors?: { message?: string }[] } | undefined;
      const msg = d?.error ?? d?.detail ?? d?.errors?.[0]?.message ?? d?.title ?? `HTTP ${res.status}`;
      throw new ApiError(res.status, msg, data);
    }
    return data as T;
  }

  // ── identity / workspaces ───────────────────────────────────────────────

  async me(): Promise<Identity> {
    if (this.meCache) return this.meCache;
    const r = await this.request<Identity>("GET", "/api/auth/me");
    this.meCache = { id: r.id, email: r.email };
    return this.meCache;
  }

  async workspaces(): Promise<Workspace[]> {
    const r = await this.request<{ workspaces: Workspace[] | null }>("GET", "/api/me/workspaces");
    return r.workspaces ?? [];
  }

  async createWorkspace(name: string, slug?: string, locale?: "en" | "ar"): Promise<Workspace> {
    const r = await this.request<{ workspace: Workspace }>("POST", "/api/me/workspaces", {
      body: { name, ...(slug ? { slug } : {}), ...(locale ? { locale } : {}) },
    });
    return r.workspace;
  }

  // ── time ────────────────────────────────────────────────────────────────

  async running(): Promise<TimeEntry | null> {
    const r = await this.request<{ timer: TimeEntry | null }>("GET", "/api/w/time/running");
    return r.timer ?? null;
  }

  /** Starts a timer; the running one (if any) stops in the same transaction. */
  start(input: StartInput): Promise<TimerChange> {
    return this.request<TimerChange>("POST", "/api/w/time/start", { body: input });
  }

  stop(): Promise<TimeEntry> {
    return this.request<TimeEntry>("POST", "/api/w/time/stop", { body: {} });
  }

  updateEntry(id: string, patch: EntryPatch): Promise<TimeEntry> {
    return this.request<TimeEntry>("PATCH", `/api/w/time/entries/${encodeURIComponent(id)}`, { body: patch });
  }

  logTime(input: LogInput): Promise<TimeEntry> {
    return this.request<TimeEntry>("POST", "/api/w/time/entries", { body: input });
  }

  async entries(q: { from?: string; to?: string; project?: string; limit?: number } = {}): Promise<TimeEntry[]> {
    const r = await this.request<{ entries: TimeEntry[] | null }>("GET", "/api/w/time/entries", { query: q });
    return r.entries ?? [];
  }

  /** Entries that started today on this device's calendar, newest first. */
  async entriesToday(now = new Date(this.now())): Promise<TimeEntry[]> {
    const today = localDate(now);
    const yesterday = localDate(new Date(now.getTime() - 86_400_000));
    // The API cuts days in the workspace timezone; ask for two days and cut locally.
    const list = await this.entries({ from: yesterday, to: today, limit: 200 });
    return list.filter((e) => localDate(new Date(e.started_at)) === today);
  }

  // ── work ────────────────────────────────────────────────────────────────

  async projects(): Promise<Project[]> {
    const r = await this.request<{ projects: Project[] | null }>("GET", "/api/w/projects");
    return r.projects ?? [];
  }

  async tasks(q: { project?: string; status?: string; category?: "todo" | "doing" | "done"; assignee?: string; q?: string; limit?: number } = {}): Promise<Task[]> {
    const r = await this.request<{ tasks: Task[] | null }>("GET", "/api/w/tasks", { query: q });
    return r.tasks ?? [];
  }

  /**
   * Open tasks assigned to me in board order (the API orders by project, column position, card
   * position): in-progress columns first, then to-do columns.
   */
  async myTasks(limit = 50): Promise<{ doing: Task[]; todo: Task[] }> {
    const me = await this.me();
    const [doing, todo] = await Promise.all([
      this.tasks({ assignee: me.id, category: "doing", limit }),
      this.tasks({ assignee: me.id, category: "todo", limit }),
    ]);
    return { doing, todo };
  }

  /** Workspace issues in board order. The API has no assignee on issues; `state` filters open/closed. */
  async issues(q: { state?: "open" | "closed"; status?: string; project?: string; q?: string } = {}): Promise<Issue[]> {
    const r = await this.request<{ issues: Issue[] | null }>("GET", "/api/w/issues", { query: q });
    return r.issues ?? [];
  }

  createIssue(input: CreateIssueInput): Promise<IssueDetail> {
    return this.request<IssueDetail>("POST", "/api/w/issues", { body: input });
  }

  /** One issue in full, with its comment thread. `key` is the MG-12 form, not the id. */
  issue(key: string): Promise<IssueDetail> {
    return this.request<IssueDetail>("GET", `/api/w/issues/${encodeURIComponent(key)}`);
  }

  /** Triage an issue: status, priority, type, state. Only what a small panel should offer. */
  updateIssue(key: string, patch: { status?: string; priority?: string; state?: "open" | "closed" }): Promise<IssueDetail> {
    return this.request<IssueDetail>("PATCH", `/api/w/issues/${encodeURIComponent(key)}`, { body: patch });
  }

  /** Reply on an issue, as the signed-in user. */
  commentOnIssue(key: string, body: string): Promise<unknown> {
    return this.request("POST", `/api/w/issues/${encodeURIComponent(key)}/comments`, { body: { body } });
  }

  /** "Next up": my open tasks (doing, then todo) followed by open issues I reported or that are in progress. */
  async nextUp(limit = 30): Promise<NextItem[]> {
    const [mine, projects, issues, me] = await Promise.all([
      this.myTasks(limit),
      this.projects(),
      this.issues({ state: "open" }).catch(() => [] as Issue[]),
      this.me(),
    ]);
    const pname = new Map(projects.map((p) => [p.id, p.name]));
    const items: NextItem[] = [];
    const push = (t: Task, doing: boolean) =>
      items.push({ kind: "task", key: t.key, title: t.title, projectId: t.project_id, projectName: pname.get(t.project_id) ?? "", doing, priority: t.priority, task: t });
    mine.doing.forEach((t) => push(t, true));
    mine.todo.forEach((t) => push(t, false));
    for (const i of issues) {
      const doing = i.status === "in_progress";
      if (!doing && i.reporter_id !== me.id) continue;
      items.push({
        kind: "issue",
        key: i.key,
        title: i.title,
        projectId: i.project_id,
        projectName: i.project_id ? (pname.get(i.project_id) ?? null) : null,
        doing,
        priority: i.priority,
        issue: i,
      });
    }
    return items.slice(0, limit);
  }

  /** Starts a timer on a Next-up item. Issues are not tasks: the timer goes on the issue's project with its key. */
  startOn(item: NextItem, description?: string): Promise<TimerChange> {
    if (item.kind === "task") return this.start({ task: item.task.id, ...(description ? { description } : {}) });
    return this.start({
      ...(item.projectId ? { project: item.projectId } : {}),
      description: description || `${item.key} ${item.title}`,
    });
  }

  // ── notifications ───────────────────────────────────────────────────────

  async notifications(limit = 20): Promise<Inbox> {
    const r = await this.request<Inbox>("GET", "/api/w/notifications", { query: { limit } });
    return { notifications: r.notifications ?? [], unread: r.unread ?? 0 };
  }

  markAllRead(): Promise<{ read: number }> {
    return this.request("POST", "/api/w/notifications/read-all");
  }

  // ── realtime ────────────────────────────────────────────────────────────

  /**
   * Reads GET /api/w/events once, until it ends or `signal` aborts. Use `liveStream` for a
   * reconnecting subscription. Returns the server's retry hint.
   */
  async stream(onEvent: (ev: LiveEvent) => void, signal?: AbortSignal): Promise<number | undefined> {
    await this.ensureFresh();
    const res = await this.f(this.url("/api/w/events"), {
      headers: { ...this.headers("/api/w/events", {}, false), Accept: "text/event-stream" },
      ...(signal ? { signal } : {}),
    });
    if (res.status === 401) {
      if (await this.tryRelogin()) return 0;
      this.setToken(null);
      this.opts.onAuthRequired?.();
      throw new ApiError(401, "session expired — sign in again");
    }
    if (!res.ok || !res.body) throw new ApiError(res.status, `event stream failed: HTTP ${res.status}`);
    const parser = new SseParser();
    for await (const ev of readSse(res.body, parser)) {
      const e = toLiveEvent(ev.event, ev.data);
      if (e) onEvent(e);
    }
    return parser.retry;
  }
}

/** Maps a raw SSE event from /api/w/events to a typed LiveEvent. */
export function toLiveEvent(name: string, raw: string): LiveEvent | null {
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return { type: "other", name, data: raw };
  }
  switch (name) {
    case "timer.state":
      return { type: "timer.state", running: ((data as { running?: TimeEntry | null } | null)?.running ?? null) };
    case "timer.started":
      return { type: "timer.started", entry: data as TimeEntry };
    case "timer.stopped":
      return { type: "timer.stopped", entry: data as TimeEntry };
    case "entry.changed":
      return { type: "entry.changed", data };
    default:
      if (name.startsWith("notification")) return { type: "notification", name, data };
      return { type: "other", name, data };
  }
}

export interface LiveHandle {
  close(): void;
}

/**
 * A reconnecting subscription to the workspace event stream. Reconnects with the server's retry
 * hint (3s) and backs off to 60s on errors; stops on close() or when sign-in is required.
 */
export function liveStream(
  client: MahaamClient,
  onEvent: (ev: LiveEvent) => void,
  opts: { onStatus?: (s: "open" | "reconnecting" | "closed") => void; maxDelay?: number } = {},
): LiveHandle {
  let ctrl: AbortController | null = null;
  let closed = false;
  let delay = 3000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = async () => {
    if (closed) return;
    ctrl = new AbortController();
    try {
      opts.onStatus?.("open");
      const retry = await client.stream((e) => {
        delay = 3000;
        onEvent(e);
      }, ctrl.signal);
      if (retry !== undefined) delay = Math.max(retry, 1000);
    } catch (err) {
      if (closed) return;
      if (err instanceof ApiError && err.status === 401) {
        closed = true;
        opts.onStatus?.("closed");
        return;
      }
      delay = Math.min(delay * 2, opts.maxDelay ?? 60_000);
    }
    if (closed) return;
    opts.onStatus?.("reconnecting");
    timer = setTimeout(run, delay);
  };
  void run();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      opts.onStatus?.("closed");
    },
  };
}
