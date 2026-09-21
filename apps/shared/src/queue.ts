/**
 * An offline queue for writes, with replay that cannot double-bill anyone.
 *
 * The hard part of replaying queued time entries is not the queue, it is deciding what a failure
 * means. That question is already settled server-side: `no_overlap` makes the same block
 * un-insertable twice for one person, and the API turns that into a 409 (see MH-81, and the test
 * pinning it in internal/server/time_test.go). A replayed item that comes back 409 is therefore
 * *already recorded* — the correct response is to drop it, not to retry it and not to show the
 * user an error.
 *
 * Get that backwards and the failure modes are both bad: retrying forever wedges the queue, and
 * treating 409 as success-with-a-new-entry would duplicate billable time.
 *
 * Storage is injected so the same engine serves localStorage, chrome.storage and AsyncStorage.
 */

export interface QueueStore {
  read(): Promise<string | null>
  write(value: string): Promise<void>
}

export interface QueuedItem<T = unknown> {
  /** Stable id, so a caller can correlate a result with what it queued. */
  id: string
  /** What to replay. Opaque to the queue. */
  payload: T
  /** When it was queued (ms). Replay is oldest-first so entries land in the order they happened. */
  queuedAt: number
  /** How many times replay has been attempted. */
  attempts: number
}

export type SendResult =
  /** Accepted by the server. */
  | { kind: "ok" }
  /** The server already has it — a replay of something that landed before. Drop it. */
  | { kind: "duplicate" }
  /** The server refused it and always will (validation, permission). Dropping avoids a wedge. */
  | { kind: "rejected"; reason?: string }
  /** Transient: offline, timeout, 5xx. Keep it and try later. */
  | { kind: "retry" }

/**
 * Classifies an HTTP status for replay.
 *
 * 409 is the interesting one: for time entries it means the block is already recorded, because the
 * database refused an overlapping duplicate. 4xx otherwise is permanent — replaying a 422 forever
 * would block every item behind it.
 */
export function classify(status: number): SendResult {
  if (status >= 200 && status < 300) return { kind: "ok" }
  if (status === 409) return { kind: "duplicate" }
  if (status === 408 || status === 425 || status === 429) return { kind: "retry" }
  if (status >= 400 && status < 500) return { kind: "rejected", reason: `http ${status}` }
  return { kind: "retry" } // 5xx and anything unexpected
}

export interface FlushOutcome {
  sent: number
  duplicates: number
  rejected: number
  /** Still queued afterwards. */
  remaining: number
}

export class OfflineQueue<T = unknown> {
  constructor(
    private readonly store: QueueStore,
    /** Give up on an item after this many attempts, so one poisoned payload cannot wedge the rest. */
    private readonly maxAttempts = 8,
  ) {}

  async items(): Promise<QueuedItem<T>[]> {
    const raw = await this.store.read()
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as QueuedItem<T>[]) : []
    } catch {
      // A corrupt queue must not brick every future write.
      return []
    }
  }

  private save(items: QueuedItem<T>[]): Promise<void> {
    return this.store.write(JSON.stringify(items))
  }

  async enqueue(id: string, payload: T, now = Date.now()): Promise<void> {
    const items = await this.items()
    // Same id twice is the caller retrying, not two pieces of work.
    if (items.some((i) => i.id === id)) return
    items.push({ id, payload, queuedAt: now, attempts: 0 })
    await this.save(items)
  }

  async size(): Promise<number> {
    return (await this.items()).length
  }

  /**
   * Replays oldest-first, stopping at the first item that needs retrying so ordering is preserved
   * — a later entry must not land before an earlier one it might overlap.
   */
  async flush(send: (item: QueuedItem<T>) => Promise<SendResult>): Promise<FlushOutcome> {
    const items = await this.items()
    const out: FlushOutcome = { sent: 0, duplicates: 0, rejected: 0, remaining: 0 }
    const sorted = [...items].sort((a, b) => a.queuedAt - b.queuedAt)
    let i = 0
    for (; i < sorted.length; i++) {
      const item = sorted[i]!
      let res: SendResult
      try {
        res = await send(item)
      } catch {
        res = { kind: "retry" } // a thrown error is a network failure, not a verdict
      }
      if (res.kind === "retry") {
        item.attempts++
        if (item.attempts >= this.maxAttempts) {
          out.rejected++
          continue // drop it and carry on rather than wedging everything behind it
        }
        break // preserve order: stop here and keep the rest for next time
      }
      if (res.kind === "ok") out.sent++
      else if (res.kind === "duplicate") out.duplicates++
      else out.rejected++
    }
    const done = new Set(sorted.slice(0, i).map((x) => x.id))
    const kept = sorted.slice(i).filter((x) => x.attempts < this.maxAttempts && !done.has(x.id))
    const remaining = sorted.slice(0, i).filter((x) => !done.has(x.id)).concat(kept)
    await this.save(remaining)
    out.remaining = remaining.length
    return out
  }
}
