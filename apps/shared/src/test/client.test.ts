import { describe, expect, it, vi } from "vitest";
import { ApiError, liveStream, MahaamClient, normalizeApiUrl, tokenExpiry, type LiveEvent } from "../index";

const BASE = "http://api.test";

function jwt(expSeconds: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp: expSeconds })}.sig`;
}

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (url: URL, init: RequestInit, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(new URL(String(input)), init, calls.length);
  });
  return { f: f as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hdr = (c: Call) => new Headers(c.init.headers as HeadersInit);

const NOW = 1_800_000_000_000;
const fresh = jwt(NOW / 1000 + 86_400);

describe("auth", () => {
  it("mints a personal access token, and that token stops the silent re-login path", async () => {
    // A PAT is what a client should hold instead of the password: revocable per device, scoped,
    // and — because it is not a JWT — it never triggers the expiry-driven re-login.
    const pat = "togo_pat_" + "a".repeat(48);
    const { f, calls } = mockFetch(() => json({ token: pat, name: "Desktop", abilities: [] }));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh });

    const got = await c.createAccessToken("Desktop");
    expect(got).toBe(pat);
    const last = calls.at(-1)!;
    expect(last.url).toBe(BASE + "/api/auth/tokens");
    expect(JSON.parse(String(last.init.body))).toEqual({ name: "Desktop" });

    // The important property: no expiry, so ensureFresh() has nothing to act on.
    expect(tokenExpiry(pat)).toBeNull();
  });

  it("a stored PAT never triggers a silent re-login, unlike an expiring JWT", async () => {
    const pat = "togo_pat_" + "b".repeat(48);
    const credentials = vi.fn(async () => ({ email: "a", password: "b" }));
    const { f, calls } = mockFetch(() => json({ ok: true }));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: pat, now: () => NOW, credentials });    await c.workspaces().catch(() => {});

    // credentials() must never be consulted — that is the whole point of holding a PAT.
    expect(credentials).not.toHaveBeenCalled();
    expect(calls.some((x) => x.url.includes("/api/auth/login"))).toBe(false);
  });

  it("logs in with the double-submit CSRF pair as a cookie header", async () => {
    const onToken = vi.fn();
    const { f, calls } = mockFetch(() => json({ token: fresh }));
    const c = new MahaamClient({ baseUrl: BASE + "/", fetch: f, onToken });
    await expect(c.login("a@b.c", "pw")).resolves.toBe(fresh);
    const h = hdr(calls[0]!);
    expect(calls[0]!.url).toBe(BASE + "/api/auth/login");
    const v = h.get("X-CSRF-Token");
    expect(v).toMatch(/^[0-9a-f]{32}$/);
    expect(h.get("Cookie")).toBe(`togo_csrf=${v}`);
    expect(h.get("Authorization")).toBeNull();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: "a@b.c", password: "pw" });
    expect(onToken).toHaveBeenCalledWith(fresh);
  });

  it("in browser mode fetches /api/auth/csrf with credentials and echoes the token", async () => {
    const { f, calls } = mockFetch((u) => (u.pathname === "/api/auth/csrf" ? json({ csrf_token: "tok123" }) : json({ token: fresh })));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, csrf: "browser" });
    await c.login("a@b.c", "pw");
    expect(calls[0]!.init.credentials).toBe("include");
    expect(hdr(calls[1]!).get("X-CSRF-Token")).toBe("tok123");
    expect(hdr(calls[1]!).get("Cookie")).toBeNull();
    expect(calls[1]!.init.credentials).toBe("include");
  });

  it("maps a 401 login to 'invalid credentials' and a 429 to the API's message", async () => {
    const { f } = mockFetch((_u, _i, n) => (n === 1 ? json({ error: "invalid credentials" }, 401) : json({ error: "too many requests" }, 429)));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f });
    await expect(c.login("a", "b")).rejects.toMatchObject({ status: 401, message: "invalid credentials" });
    await expect(c.login("a", "b")).rejects.toMatchObject({ status: 429, message: "too many requests" });
  });

  it("re-logs in once from stored credentials on 401 and retries", async () => {
    const newer = jwt(NOW / 1000 + 90_000);
    const { f, calls } = mockFetch((u, init) => {
      if (u.pathname === "/api/auth/login") return json({ token: newer });
      const auth = new Headers(init.headers as HeadersInit).get("Authorization");
      return auth === `Bearer ${newer}` ? json({ timer: null }) : json({ error: "unauthorized" }, 401);
    });
    const onToken = vi.fn();
    const c = new MahaamClient({
      baseUrl: BASE,
      fetch: f,
      token: fresh,
      workspace: "acme",
      now: () => NOW,
      onToken,
      credentials: () => ({ email: "a@b.c", password: "pw" }),
    });
    await expect(c.running()).resolves.toBeNull();
    expect(calls.map((x) => new URL(x.url).pathname)).toEqual(["/api/w/time/running", "/api/auth/login", "/api/w/time/running"]);
    expect(onToken).toHaveBeenLastCalledWith(newer);
  });

  it("re-logs in ahead of time when the token expires within a minute", async () => {
    const soon = jwt(NOW / 1000 + 30);
    const { f, calls } = mockFetch((u) => (u.pathname === "/api/auth/login" ? json({ token: fresh }) : json({ workspaces: [] })));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: soon, now: () => NOW, credentials: async () => ({ email: "a", password: "b" }) });
    await c.workspaces();
    expect(new URL(calls[0]!.url).pathname).toBe("/api/auth/login");
    expect(hdr(calls[1]!).get("Authorization")).toBe(`Bearer ${fresh}`);
  });

  it("without credentials a 401 clears the token and asks for sign-in", async () => {
    const onAuthRequired = vi.fn();
    const onToken = vi.fn();
    const { f } = mockFetch(() => json({ error: "unauthorized" }, 401));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w", onAuthRequired, onToken });
    await expect(c.running()).rejects.toBeInstanceOf(ApiError);
    expect(onAuthRequired).toHaveBeenCalled();
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(c.token).toBeNull();
  });

  it("shares one re-login between concurrent requests", async () => {
    let logins = 0;
    const newer = jwt(NOW / 1000 + 90_000);
    const { f } = mockFetch((u, init) => {
      if (u.pathname === "/api/auth/login") {
        logins++;
        return json({ token: newer });
      }
      return new Headers(init.headers as HeadersInit).get("Authorization") === `Bearer ${newer}` ? json({ workspaces: [] }) : json({}, 401);
    });
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, now: () => NOW, credentials: () => ({ email: "a", password: "b" }) });
    await Promise.all([c.workspaces(), c.workspaces(), c.workspaces()]);
    expect(logins).toBe(1);
  });
});

describe("workspace-scoped calls", () => {
  it("sends Bearer + X-Workspace-ID and never CSRF headers", async () => {
    const { f, calls } = mockFetch(() => json({ started: { id: "e1" }, stopped: null }, 201));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "acme" });
    await c.start({ task: "MG-1", description: "x" });
    const h = hdr(calls[0]!);
    expect(h.get("Authorization")).toBe(`Bearer ${fresh}`);
    expect(h.get("X-Workspace-ID")).toBe("acme");
    expect(h.get("X-CSRF-Token")).toBeNull();
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ task: "MG-1", description: "x" });
  });

  it("refuses a workspace call with no workspace selected", async () => {
    const { f } = mockFetch(() => json({}));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh });
    await expect(c.running()).rejects.toThrow("no workspace selected");
  });

  it("surfaces API error bodies", async () => {
    const { f } = mockFetch((_u, _i, n) => (n === 1 ? json({ error: "task not found" }, 404) : json({ title: "Unprocessable Entity", detail: "bad" }, 422)));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
    await expect(c.start({ task: "MG-404" })).rejects.toMatchObject({ status: 404, message: "task not found" });
    await expect(c.start({ task: "MG-404" })).rejects.toMatchObject({ status: 422, message: "bad" });
  });

  it("stop sends an empty body; running unwraps timer", async () => {
    const { f, calls } = mockFetch((u) => (u.pathname.endsWith("/running") ? json({ timer: { id: "r" } }) : json({ id: "r", ended_at: "x" })));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
    expect(await c.running()).toEqual({ id: "r" });
    await c.stop();
    expect(calls[1]!.init.body).toBe("{}");
  });

  it("myTasks asks for my open tasks by category, doing first, in the API's board order", async () => {
    const { f, calls } = mockFetch((u) => {
      if (u.pathname === "/api/auth/me") return json({ id: "me1", email: "a@b.c" });
      const cat = u.searchParams.get("category");
      return json({ tasks: cat === "doing" ? [{ id: "d1" }] : [{ id: "t1" }, { id: "t2" }] });
    });
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
    const r = await c.myTasks();
    expect(r.doing.map((t) => t.id)).toEqual(["d1"]);
    expect(r.todo.map((t) => t.id)).toEqual(["t1", "t2"]);
    const q = calls.filter((x) => x.url.includes("/api/w/tasks")).map((x) => new URL(x.url).searchParams);
    expect(q).toHaveLength(2);
    expect(q.every((s) => s.get("assignee") === "me1")).toBe(true);
  });

  it("nextUp lists my tasks, then open issues I reported or that are in progress; startOn maps issues to project + key", async () => {
    const { f, calls } = mockFetch((u, init) => {
      switch (u.pathname) {
        case "/api/auth/me":
          return json({ id: "me1", email: "a" });
        case "/api/w/projects":
          return json({ projects: [{ id: "p1", name: "Apps" }] });
        case "/api/w/issues":
          return json({
            issues: [
              { key: "MG-9", title: "Mine", status: "backlog", reporter_id: "me1", project_id: "p1", priority: "medium" },
              { key: "MG-8", title: "Not mine", status: "backlog", reporter_id: "x", project_id: null, priority: "low" },
              { key: "MG-7", title: "Being worked", status: "in_progress", reporter_id: "x", project_id: null, priority: "high" },
            ],
          });
        case "/api/w/tasks":
          return json({ tasks: u.searchParams.get("category") === "doing" ? [] : [{ id: "t1", key: "MG-1", title: "T", project_id: "p1", priority: "high" }] });
        case "/api/w/time/start":
          return json({ started: JSON.parse(String(init.body)), stopped: null }, 201);
      }
      return json({}, 404);
    });
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
    const items = await c.nextUp();
    expect(items.map((i) => i.key)).toEqual(["MG-1", "MG-9", "MG-7"]);
    expect(items[0]).toMatchObject({ kind: "task", projectName: "Apps" });
    expect(new URL(calls.find((x) => x.url.includes("/api/w/issues"))!.url).searchParams.get("state")).toBe("open");
    await c.startOn(items[1]!);
    await c.startOn(items[0]!);
    const starts = calls.filter((x) => x.url.endsWith("/api/w/time/start")).map((x) => JSON.parse(String(x.init.body)));
    expect(starts).toEqual([{ project: "p1", description: "MG-9 Mine" }, { task: "t1" }]);
  });

  it("entriesToday keeps only entries started on the local calendar day", async () => {
    const now = new Date(2026, 8, 19, 10, 0, 0);
    const today = new Date(2026, 8, 19, 8, 0, 0).toISOString();
    const yesterday = new Date(2026, 8, 18, 23, 0, 0).toISOString();
    const { f, calls } = mockFetch(() => json({ entries: [{ id: "a", started_at: today }, { id: "b", started_at: yesterday }] }));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
    expect((await c.entriesToday(now)).map((e) => e.id)).toEqual(["a"]);
    const q = new URL(calls[0]!.url).searchParams;
    expect([q.get("from"), q.get("to")]).toEqual(["2026-09-18", "2026-09-19"]);
  });

  it("tolerates null arrays (Huma nullable slices)", async () => {
    const { f } = mockFetch((u) => json(u.pathname.includes("notifications") ? { notifications: null, unread: 0 } : { workspaces: null }));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
    expect(await c.workspaces()).toEqual([]);
    expect(await c.notifications()).toEqual({ notifications: [], unread: 0 });
  });
});

describe("realtime", () => {
  it("stream() reads /api/w/events with the Bearer header and emits typed events", async () => {
    const body = 'retry: 3000\n\nevent: timer.state\ndata: {"running":{"id":"e1"}}\n\nevent: timer.stopped\ndata: {"id":"e1"}\n\n';
    const { f, calls } = mockFetch(() => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "acme" });
    const got: LiveEvent[] = [];
    const retry = await c.stream((e) => got.push(e));
    expect(retry).toBe(3000);
    expect(got.map((e) => e.type)).toEqual(["timer.state", "timer.stopped"]);
    const h = hdr(calls[0]!);
    expect(h.get("Authorization")).toBe(`Bearer ${fresh}`);
    expect(h.get("X-Workspace-ID")).toBe("acme");
    expect(h.get("Accept")).toBe("text/event-stream");
  });

  it("liveStream reconnects after the stream ends and stops on close()", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const { f } = mockFetch(() => {
        n++;
        return new Response('retry: 1000\n\nevent: timer.state\ndata: {"running":null}\n\n');
      });
      const c = new MahaamClient({ baseUrl: BASE, fetch: f, token: fresh, workspace: "w" });
      const events: string[] = [];
      const h = liveStream(c, (e) => events.push(e.type));
      await vi.advanceTimersByTimeAsync(0);
      expect(n).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(n).toBe(2);
      h.close();
      await vi.advanceTimersByTimeAsync(5000);
      expect(n).toBe(2);
      expect(events).toEqual(["timer.state", "timer.state"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("helpers", () => {
  it("tokenExpiry reads exp in ms", () => {
    expect(tokenExpiry(jwt(1000))).toBe(1_000_000);
    expect(tokenExpiry("garbage")).toBeNull();
  });
  it("normalizeApiUrl", () => {
    expect(normalizeApiUrl("console.mahaam.app/")).toBe("https://console.mahaam.app");
    expect(normalizeApiUrl("http://localhost:8120/api")).toBe("http://localhost:8120");
    expect(normalizeApiUrl("")).toBe("https://console.mahaam.app");
  });
});
