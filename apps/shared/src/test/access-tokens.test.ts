import { describe, expect, it, vi } from "vitest"

import { MahaamClient } from "../index"

/**
 * replaceAccessToken — minting this device's token and clearing out the one it supersedes.
 *
 * Without the replace, every sign-in leaves another row behind and the user's device list becomes
 * thirty identical entries, at which point "revoke the browser" no longer means anything.
 */

const BASE = "http://api.test"

type Call = { method: string; url: string; body: unknown }

/** A tiny fake of the token routes: mint appends, list returns, delete removes. */
function server(seed: Array<{ id: string; name: string }> = [], opts: { failList?: boolean; failDelete?: boolean } = {}) {
  let rows = [...seed]
  let n = 0
  const calls: Call[] = []
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? "GET"
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })

    if (method === "POST") {
      const id = `t${++n}`
      rows.push({ id, name: (body as { name: string }).name })
      return new Response(JSON.stringify({ token: `togo_pat_${id}` }), { status: 201 })
    }
    if (method === "GET") {
      if (opts.failList) return new Response(JSON.stringify({ error: "nope" }), { status: 404 })
      return new Response(JSON.stringify(rows.map((r) => ({ ...r, abilities: [], created_at: "", expires_at: "" }))), { status: 200 })
    }
    if (method === "DELETE") {
      if (opts.failDelete) return new Response(JSON.stringify({ error: "nope" }), { status: 500 })
      const id = url.split("/").pop()!
      rows = rows.filter((r) => r.id !== id)
      return new Response(JSON.stringify({ status: "revoked" }), { status: 200 })
    }
    return new Response("{}", { status: 200 })
  })
  return { f: f as unknown as typeof fetch, calls, rows: () => rows }
}

const client = (f: typeof fetch) => new MahaamClient({ baseUrl: BASE, fetch: f, token: "togo_pat_existing" })

describe("createAccessToken", () => {
  it("does not ask for abilities, because a token that claims to be scoped is not", async () => {
    // The server refuses a scoped request rather than issue a narrow-looking token that can do
    // everything its owner can, so the client must not send any.
    const s = server()
    await client(s.f).createAccessToken("Desktop")
    expect(s.calls.at(-1)!.body).toEqual({ name: "Desktop" })
  })
})

describe("replaceAccessToken", () => {
  it("mints a new token and revokes the old one of the same name", async () => {
    const s = server([{ id: "old", name: "Mahaam extension — Chrome" }])
    const token = await client(s.f).replaceAccessToken("Mahaam extension — Chrome")

    expect(token).toBe("togo_pat_t1")
    expect(s.rows().map((r) => r.id)).toEqual(["t1"])
  })

  it("never revokes the token it just minted", async () => {
    // The new token has the same name as the old one, so a naive "revoke everything called this"
    // after minting would delete the token the caller is about to store and sign-in would break
    // on the very next request.
    const s = server([{ id: "old", name: "Browser" }])
    const token = await client(s.f).replaceAccessToken("Browser")
    const deleted = s.calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/").pop())

    expect(token).toBe("togo_pat_t1")
    expect(deleted).toEqual(["old"])
    expect(s.rows()).toHaveLength(1)
  })

  it("lists before minting, so the new token cannot be caught in the sweep", async () => {
    const s = server([{ id: "old", name: "Browser" }])
    await client(s.f).replaceAccessToken("Browser")
    expect(s.calls.map((c) => c.method)).toEqual(["GET", "POST", "DELETE"])
  })

  it("leaves another device's token alone", async () => {
    const s = server([
      { id: "phone", name: "Mahaam mobile — Pixel" },
      { id: "old", name: "Browser" },
    ])
    await client(s.f).replaceAccessToken("Browser")
    expect(s.rows().map((r) => r.id).sort()).toEqual(["phone", "t1"])
  })

  it("revokes several stale rows left by earlier versions", async () => {
    const s = server([
      { id: "a", name: "Browser" },
      { id: "b", name: "Browser" },
    ])
    await client(s.f).replaceAccessToken("Browser")
    expect(s.rows().map((r) => r.id)).toEqual(["t1"])
  })

  it("still mints when the server cannot list tokens", async () => {
    // An older self-hosted server. A tidy device list is not worth a failed sign-in.
    const s = server([], { failList: true })
    await expect(client(s.f).replaceAccessToken("Browser")).resolves.toBe("togo_pat_t1")
  })

  it("still returns the new token when revoking the old one fails", async () => {
    // A stale row is untidy; no token at all is a broken sign-in.
    const s = server([{ id: "old", name: "Browser" }], { failDelete: true })
    await expect(client(s.f).replaceAccessToken("Browser")).resolves.toBe("togo_pat_t1")
  })

  it("fails when minting itself fails, rather than pretending to be signed in", async () => {
    const f = vi.fn(async (_i: RequestInfo | URL, init: RequestInit = {}) =>
      (init.method ?? "GET") === "GET"
        ? new Response("[]", { status: 200 })
        : new Response(JSON.stringify({ error: "no" }), { status: 500 }),
    ) as unknown as typeof fetch
    await expect(client(f).replaceAccessToken("Browser")).rejects.toThrow()
  })

  it("revokes nothing when there was nothing there", async () => {
    const s = server()
    await client(s.f).replaceAccessToken("Browser")
    expect(s.calls.some((c) => c.method === "DELETE")).toBe(false)
  })
})
