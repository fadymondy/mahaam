import { MahaamClient, type KeyValueStore } from "../client";
import { api as endpoints } from "../endpoints";

/**
 * The team-side issue endpoints.
 *
 * A wrong URL or verb here does not fail loudly — it returns a 404 the screen shows as "this issue
 * is not available", which reads exactly like a permission problem. These pin the request that
 * actually goes out.
 */

function memStore(init: Record<string, string> = {}): KeyValueStore {
  const data = { ...init };
  return {
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    del: async (k) => {
      delete data[k];
    },
  };
}

type Call = { url: string; method: string; body: unknown };

function harness() {
  const calls: Call[] = [];
  const f = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ key: "MH-1", comments: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const client = new MahaamClient({
    baseUrl: "http://api.test",
    fetch: f as unknown as typeof fetch,
    store: memStore({ "mahaam.token": "togo_pat_x", "mahaam.ws": JSON.stringify({ id: "ws1" }) }),
  });
  return { api: endpoints(client), calls };
}

describe("team issue endpoints", () => {
  it("fetches one issue by key", async () => {
    const { api, calls } = harness();
    await api.issues.get("MH-12");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain("/api/w/issues/MH-12");
  });

  it("encodes a key rather than pasting it into the path", async () => {
    // Keys are server-generated today, so this is about not being the place that breaks when
    // something else changes — a path separator in a key would otherwise silently retarget the
    // request at a different route.
    const { api, calls } = harness();
    await api.issues.get("MH/12");
    expect(calls[0]!.url).toContain("MH%2F12");
    expect(calls[0]!.url).not.toContain("MH/12");
  });

  it("posts a comment to the comments route", async () => {
    const { api, calls } = harness();
    await api.issues.comment("MH-12", "looks right");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("/api/w/issues/MH-12/comments");
    expect(calls[0]!.body).toEqual({ body: "looks right" });
  });

  it("moves a stage with PATCH, not POST", async () => {
    // POST /api/w/issues is *create*. Getting this verb wrong would file a new issue every time
    // someone moved a card.
    const { api, calls } = harness();
    await api.issues.move("MH-12", "in_review");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toContain("/api/w/issues/MH-12");
    expect(calls[0]!.body).toEqual({ status: "in_review" });
  });

  it("creates an issue on the collection route", async () => {
    const { api, calls } = harness();
    await api.issues.create({ title: "New", body: "details", project: "p1" });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toMatch(/\/api\/w\/issues$/);
    expect(calls[0]!.body).toEqual({ title: "New", body: "details", project: "p1" });
  });

  it("still lists open issues only", async () => {
    const { api, calls } = harness();
    await api.issues.list();
    expect(calls[0]!.url).toContain("state=open");
  });
});
