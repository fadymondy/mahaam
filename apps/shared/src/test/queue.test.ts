import { describe, expect, it, vi } from "vitest"

import { classify, OfflineQueue, type QueuedItem, type QueueStore, type SendResult } from "../queue"

function memStore(initial: string | null = null): QueueStore & { value: string | null } {
  const s = {
    value: initial,
    async read() {
      return s.value
    },
    async write(v: string) {
      s.value = v
    },
  }
  return s
}

const ok = async (): Promise<SendResult> => ({ kind: "ok" })

describe("classify", () => {
  it("treats 409 as already-recorded, not an error", () => {
    // The whole safety property: no_overlap means a replayed block is already there.
    expect(classify(409)).toEqual({ kind: "duplicate" })
  })

  it("treats 2xx as sent and 5xx as retryable", () => {
    expect(classify(200).kind).toBe("ok")
    expect(classify(201).kind).toBe("ok")
    expect(classify(500).kind).toBe("retry")
    expect(classify(503).kind).toBe("retry")
  })

  it("treats ordinary 4xx as permanent, so one bad item cannot wedge the queue", () => {
    expect(classify(422).kind).toBe("rejected")
    expect(classify(403).kind).toBe("rejected")
  })

  it("keeps the throttling and timeout codes retryable", () => {
    expect(classify(408).kind).toBe("retry")
    expect(classify(429).kind).toBe("retry")
  })
})

describe("OfflineQueue", () => {
  it("queues and reports its size", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("a", { m: 1 }, 1)
    await q.enqueue("b", { m: 2 }, 2)
    expect(await q.size()).toBe(2)
  })

  it("ignores a repeated id — that is a caller retrying, not new work", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("a", { m: 1 }, 1)
    await q.enqueue("a", { m: 999 }, 2)
    const items = await q.items()
    expect(items).toHaveLength(1)
    expect(items[0]!.payload).toEqual({ m: 1 })
  })

  it("replays oldest first, so entries land in the order they happened", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("second", { m: 2 }, 200)
    await q.enqueue("first", { m: 1 }, 100)
    const seen: string[] = []
    await q.flush(async (i) => {
      seen.push(i.id)
      return { kind: "ok" }
    })
    expect(seen).toEqual(["first", "second"])
  })

  it("drops a duplicate instead of retrying it or reporting failure", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("a", { m: 1 }, 1)
    const out = await q.flush(async () => ({ kind: "duplicate" }))
    expect(out).toMatchObject({ duplicates: 1, remaining: 0 })
    expect(await q.size()).toBe(0)
  })

  it("stops at the first retry and keeps the rest queued, preserving order", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("a", { m: 1 }, 1)
    await q.enqueue("b", { m: 2 }, 2)
    await q.enqueue("c", { m: 3 }, 3)
    const send = vi.fn(async (i: QueuedItem) => (i.id === "b" ? { kind: "retry" as const } : { kind: "ok" as const }))
    const out = await q.flush(send)
    expect(out.sent).toBe(1)
    // c must not be sent ahead of b
    expect(send.mock.calls.map((c) => c[0].id)).toEqual(["a", "b"])
    expect((await q.items()).map((i) => i.id)).toEqual(["b", "c"])
  })

  it("treats a thrown error as retryable, not as a verdict", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("a", { m: 1 }, 1)
    await q.flush(async () => {
      throw new Error("offline")
    })
    expect(await q.size()).toBe(1)
  })

  it("gives up on an item that keeps failing, rather than wedging the queue behind it", async () => {
    const q = new OfflineQueue(memStore(), 3)
    await q.enqueue("bad", { m: 1 }, 1)
    await q.enqueue("good", { m: 2 }, 2)
    for (let i = 0; i < 3; i++) {
      await q.flush(async (it) => (it.id === "bad" ? { kind: "retry" } : { kind: "ok" }))
    }
    const ids = (await q.items()).map((i) => i.id)
    expect(ids).not.toContain("bad")
    // and "good" is free to go through now
    const out = await q.flush(ok)
    expect(out.sent + out.duplicates).toBeGreaterThanOrEqual(0)
    expect(await q.size()).toBe(0)
  })

  it("drops a permanently rejected item", async () => {
    const q = new OfflineQueue(memStore())
    await q.enqueue("a", { m: 1 }, 1)
    const out = await q.flush(async () => ({ kind: "rejected", reason: "http 422" }))
    expect(out.rejected).toBe(1)
    expect(await q.size()).toBe(0)
  })

  it("survives a corrupt store instead of bricking every future write", async () => {
    const q = new OfflineQueue(memStore("{not json"))
    expect(await q.items()).toEqual([])
    await q.enqueue("a", { m: 1 }, 1)
    expect(await q.size()).toBe(1)
  })
})
