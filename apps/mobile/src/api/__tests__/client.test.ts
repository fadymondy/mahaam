import { ApiError, MahaamClient, jwtExpiry, type KeyValueStore } from "../client";

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    del: async (k) => {
      delete data[k];
    },
  };
}

let serial = 0;
function jwt(expSeconds: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp: expSeconds, jti: ++serial })}.sig`;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length);
  });
  return { f: f as unknown as typeof fetch, calls };
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];
const future = () => Math.floor(Date.now() / 1000) + 3600;

describe("MahaamClient auth dance", () => {
  it("login sends the double-submit CSRF token as cookie + header and stores the session", async () => {
    const token = jwt(future());
    const { f, calls } = mockFetch(() => json(200, { token, user: { id: "u1", email: "a@b.c" } }));
    const store = memStore();
    const c = new MahaamClient({ baseUrl: "http://api", store, fetch: f, randomToken: () => "csrf123" });

    const user = await c.login("a@b.c", "pw");

    expect(user).toEqual({ id: "u1", email: "a@b.c" });
    expect(calls[0].url).toBe("http://api/api/auth/login");
    expect(calls[0].init.method).toBe("POST");
    expect(header(calls[0], "X-CSRF-Token")).toBe("csrf123");
    expect(header(calls[0], "Cookie")).toBe("togo_csrf=csrf123");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "a@b.c", password: "pw" });
    expect(store.data["mahaam.token"]).toBe(token);
    expect(JSON.parse(store.data["mahaam.creds"])).toEqual({ email: "a@b.c", password: "pw" });
  });

  it("on web writes the CSRF cookie instead of sending a Cookie header", async () => {
    const { f, calls } = mockFetch(() => json(200, { token: jwt(future()), user: { id: "u1", email: "x" } }));
    const cookie = jest.fn();
    const c = new MahaamClient({ baseUrl: "", store: memStore(), fetch: f, randomToken: () => "v", setCsrfCookie: cookie });
    await c.login("x", "y");
    expect(cookie).toHaveBeenCalledWith("v");
    expect(header(calls[0], "Cookie")).toBeUndefined();
    expect(header(calls[0], "X-CSRF-Token")).toBe("v");
  });

  it("sends Bearer and X-Workspace-ID on workspace calls", async () => {
    const { f, calls } = mockFetch(() => json(200, { timer: null }));
    const c = new MahaamClient({ baseUrl: "http://api", store: memStore(), fetch: f });
    c.token = jwt(future());
    await c.setWorkspace("ws-1");
    await c.get("/api/w/time/running");
    await c.get("/api/me/workspaces", { workspace: false });
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${c.token}`);
    expect(header(calls[0], "X-Workspace-ID")).toBe("ws-1");
    expect(header(calls[1], "X-Workspace-ID")).toBeUndefined();
  });

  it("re-logs in silently on 401 and replays the request", async () => {
    const fresh = jwt(future());
    const { f, calls } = mockFetch((call) => {
      if (call.url.endsWith("/api/auth/login")) return json(200, { token: fresh, user: { id: "u1", email: "a" } });
      return header(call, "Authorization") === `Bearer ${fresh}` ? json(200, { ok: true }) : json(401, { error: "unauthorized" });
    });
    const store = memStore({ "mahaam.creds": JSON.stringify({ email: "a", password: "p" }) });
    const c = new MahaamClient({ baseUrl: "", store, fetch: f });
    c.token = jwt(future()); // not expired, but the server rejects it (e.g. secret rotated)

    await expect(c.get("/api/w/tasks")).resolves.toEqual({ ok: true });
    expect(calls.map((x) => x.url)).toEqual(["/api/w/tasks", "/api/auth/login", "/api/w/tasks"]);
    expect(store.data["mahaam.token"]).toBe(fresh);
  });

  it("shares one re-login between concurrent 401s", async () => {
    const fresh = jwt(future());
    let logins = 0;
    const { f } = mockFetch(async (call) => {
      if (call.url.endsWith("/api/auth/login")) {
        logins++;
        await new Promise((r) => setTimeout(r, 5));
        return json(200, { token: fresh, user: { id: "u1", email: "a" } });
      }
      return header(call, "Authorization") === `Bearer ${fresh}` ? json(200, { ok: 1 }) : json(401, {});
    });
    const c = new MahaamClient({ baseUrl: "", store: memStore({ "mahaam.creds": '{"email":"a","password":"p"}' }), fetch: f });
    c.token = jwt(future());
    await Promise.all([c.get("/a"), c.get("/b"), c.get("/c")]);
    expect(logins).toBe(1);
  });

  it("re-logs in before the call when the JWT is expired", async () => {
    const fresh = jwt(future());
    const { f, calls } = mockFetch((call) =>
      call.url.endsWith("/api/auth/login") ? json(200, { token: fresh, user: { id: "u1", email: "a" } }) : json(200, {}),
    );
    const c = new MahaamClient({ baseUrl: "", store: memStore({ "mahaam.creds": '{"email":"a","password":"p"}' }), fetch: f });
    c.token = jwt(Math.floor(Date.now() / 1000) - 10);
    await c.get("/x");
    expect(calls.map((x) => x.url)).toEqual(["/api/auth/login", "/x"]);
    expect(header(calls[1], "Authorization")).toBe(`Bearer ${fresh}`);
  });

  it("clears the session and reports it lost when the stored password no longer works", async () => {
    const { f } = mockFetch((call) => (call.url.endsWith("/api/auth/login") ? json(401, { error: "invalid credentials" }) : json(401, {})));
    const lost = jest.fn();
    const store = memStore({ "mahaam.creds": '{"email":"a","password":"old"}', "mahaam.token": "t" });
    const c = new MahaamClient({ baseUrl: "", store, fetch: f, onSessionLost: lost });
    c.token = jwt(future());
    await expect(c.get("/x")).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(store.data["mahaam.creds"]).toBeUndefined();
    expect(c.token).toBeNull();
  });

  it("keeps the credentials when re-login is rate limited", async () => {
    const { f } = mockFetch((call) => (call.url.endsWith("/api/auth/login") ? json(429, { error: "too many requests" }) : json(401, {})));
    const store = memStore({ "mahaam.creds": '{"email":"a","password":"p"}' });
    const c = new MahaamClient({ baseUrl: "", store, fetch: f });
    c.token = jwt(future());
    await expect(c.get("/x")).rejects.toMatchObject({ status: 429 });
    expect(store.data["mahaam.creds"]).toBeDefined();
  });

  it("retries idempotent calls on network errors and 503, not POSTs", async () => {
    const sleep = jest.fn(async () => {});
    let n = 0;
    const { f, calls } = mockFetch(() => {
      n++;
      if (n === 1) throw new TypeError("Network request failed");
      if (n === 2) return json(503, {});
      return json(200, { ok: true });
    });
    const c = new MahaamClient({ baseUrl: "", store: memStore(), fetch: f, sleep });
    c.token = jwt(future());
    await expect(c.get("/x")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const post = mockFetch(() => json(503, { error: "down" }));
    const c2 = new MahaamClient({ baseUrl: "", store: memStore(), fetch: post.f, sleep });
    c2.token = jwt(future());
    await expect(c2.post("/api/w/time/start", {})).rejects.toMatchObject({ status: 503, message: "down" });
    expect(post.calls).toHaveLength(1);
  });

  it("maps API errors (huma detail, raw error) and network failures to ApiError", async () => {
    const { f } = mockFetch((call) =>
      call.url === "/a" ? json(422, { title: "Unprocessable", detail: "the end must be after the start" }) : json(404, { error: "not found" }),
    );
    const c = new MahaamClient({ baseUrl: "", store: memStore(), fetch: f, retries: 0 });
    c.token = jwt(future());
    await expect(c.get("/a")).rejects.toMatchObject({ status: 422, message: "the end must be after the start" });
    await expect(c.optional("/b")).resolves.toBeNull();

    const down = mockFetch(() => {
      throw new TypeError("Network request failed");
    });
    const c3 = new MahaamClient({ baseUrl: "", store: memStore(), fetch: down.f, retries: 0 });
    c3.token = jwt(future());
    const err = (await c3.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isNetwork).toBe(true);
  });

  it("sends FormData untouched (no JSON content type) for multipart intakes", async () => {
    const { f, calls } = mockFetch(() => json(201, { key: "MG-9" }));
    const c = new MahaamClient({ baseUrl: "", store: memStore(), fetch: f });
    c.token = jwt(future());
    const form = new FormData();
    form.append("title", "Broken");
    await expect(c.request("/api/w/portal/issues", { method: "POST", form })).resolves.toEqual({ key: "MG-9" });
    expect(calls[0].init.body).toBe(form);
    expect(header(calls[0], "Content-Type")).toBeUndefined();
  });

  it("reads the JWT expiry", () => {
    expect(jwtExpiry(jwt(1_000))).toBe(1_000_000);
    expect(jwtExpiry("garbage")).toBeNull();
  });
});
