import { describe, expect, it, vi } from "vitest"

import { ApiError, isBrowserSessionMissing, MahaamClient } from "../index"

/**
 * tokenFromBrowserSession — the extension's sign-in for accounts that have no password.
 *
 * A Google or GitHub sign-up gets the password hash "!sso" from the auth plugin, so the email and
 * password form can never let them in. What they do have is the session cookie the web app set in
 * this very browser; these tests pin how the client turns that into a revocable PAT.
 */

const BASE = "http://api.test"

type Call = { method: string; path: string; init: RequestInit }

function server(opts: { signedIn?: boolean; tokens?: Array<{ id: string; name: string }> } = {}) {
  const calls: Call[] = []
  let rows = [...(opts.tokens ?? [])]
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const u = new URL(String(input))
    const method = init.method ?? "GET"
    calls.push({ method, path: u.pathname, init })
    const bearer = new Headers(init.headers as HeadersInit).get("Authorization")
    const cookie = init.credentials === "include" && opts.signedIn !== false
    const authed = cookie || bearer === "Bearer togo_pat_new"
    if (u.pathname === "/api/auth/csrf") return Response.json({ csrf_token: "c1" })
    if (!authed) return Response.json({ error: "unauthorized" }, { status: 401 })
    if (u.pathname === "/api/auth/me") return Response.json({ id: "u1", email: "sso@example.com" })
    if (u.pathname === "/api/auth/tokens" && method === "GET") return Response.json(rows)
    if (u.pathname === "/api/auth/tokens" && method === "POST") {
      rows.push({ id: "new", name: JSON.parse(String(init.body)).name })
      return Response.json({ token: "togo_pat_new" }, { status: 201 })
    }
    if (u.pathname.startsWith("/api/auth/tokens/") && method === "DELETE") {
      rows = rows.filter((r) => r.id !== u.pathname.split("/").pop())
      return Response.json({ status: "revoked" })
    }
    return Response.json({ error: "not found" }, { status: 404 })
  })
  return { f: f as unknown as typeof fetch, calls, rows: () => rows }
}

describe("tokenFromBrowserSession", () => {
  it("mints the PAT from the cookie session, CSRF-checked, and replaces this browser's old one", async () => {
    const s = server({ tokens: [{ id: "old", name: "Mahaam extension — Chrome" }, { id: "phone", name: "Phone" }] })
    const c = new MahaamClient({ baseUrl: BASE, fetch: s.f, csrf: "browser" })

    const out = await c.tokenFromBrowserSession("Mahaam extension — Chrome")

    expect(out).toEqual({ token: "togo_pat_new", email: "sso@example.com" })
    expect(c.token).toBe("togo_pat_new")
    const mint = s.calls.find((x) => x.method === "POST" && x.path === "/api/auth/tokens")!
    // The cookie is the credential here, so the request must carry it and echo the CSRF token;
    // it must not also send a bearer, which the server would prefer over the cookie.
    expect(mint.init.credentials).toBe("include")
    expect(new Headers(mint.init.headers as HeadersInit).get("X-CSRF-Token")).toBe("c1")
    expect(new Headers(mint.init.headers as HeadersInit).get("Authorization")).toBeNull()
    expect(JSON.parse(String(mint.init.body))).toEqual({ name: "Mahaam extension — Chrome" })
    expect(s.rows().map((r) => r.id).sort()).toEqual(["new", "phone"])
  })

  it("says so, recognisably, when the browser is not signed in", async () => {
    const s = server({ signedIn: false })
    const c = new MahaamClient({ baseUrl: BASE, fetch: s.f, csrf: "browser" })

    const err = await c.tokenFromBrowserSession("x").catch((e: unknown) => e)

    expect(isBrowserSessionMissing(err)).toBe(true)
    expect(c.token).toBeNull()
    expect(s.calls.some((x) => x.method === "POST")).toBe(false)
  })

  it("is refused outside a browser, where there is no cookie jar to use", async () => {
    const s = server()
    const c = new MahaamClient({ baseUrl: BASE, fetch: s.f })

    await expect(c.tokenFromBrowserSession("x")).rejects.toBeInstanceOf(ApiError)
    expect(s.calls).toHaveLength(0)
  })

  it("does not confuse a wrong password with a missing session", () => {
    expect(isBrowserSessionMissing(new ApiError(401, "invalid credentials", { error: "invalid credentials" }))).toBe(false)
  })
})
