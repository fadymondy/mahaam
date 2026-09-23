import { dialog, powerMonitor } from "electron"

import { discardableSpan, endAfterDiscard, idleStartedAt, type AwaySpan } from "@mahaam/client"
import type { TimeEntry } from "@mahaam/client"

/**
 * Watches for the person walking away while a timer runs, and offers to cut the entry back to the
 * moment they left.
 *
 * The timer is never paused: the server owns the clock and an entry is a start and an end, not a
 * stoppable stopwatch. Discarding sets `ended_at` to when they went idle, which both trims the
 * billed time and stops the entry in one write.
 *
 * All the arithmetic lives in @mahaam/client (idle.ts) where it is tested without an OS; this file
 * only supplies the OS reading and performs the write.
 */

const POLL_MS = 30_000

export interface IdleWatchDeps {
  /** The running entry, or null. Read fresh on every tick — it changes underneath us. */
  running: () => TimeEntry | null
  /** Cut the entry short. Setting ended_at also stops it. */
  cut: (id: string, endedAt: string) => Promise<unknown>
  /** Localised prompt copy. */
  strings: () => { title: string; body: (minutes: number) => string; keep: string; discard: string }
  log?: (msg: string, err?: unknown) => void
}

export function startIdleWatch(deps: IdleWatchDeps): () => void {
  let awaySince: number | null = null
  let asking = false

  const tick = async () => {
    const entry = deps.running()
    if (!entry || entry.ended_at) {
      awaySince = null // nothing running; forget any away period
      return
    }
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const startedIdle = idleStartedAt(idleSeconds, Date.now())

    if (startedIdle !== null) {
      // Still away. Keep the earliest reading: the OS keeps counting up, and we want when it began.
      awaySince = awaySince === null ? startedIdle : Math.min(awaySince, startedIdle)
      return
    }
    if (awaySince === null || asking) return

    // They are back. Decide whether the away period is worth interrupting them about.
    const entryStart = Date.parse(entry.started_at)
    const span = discardableSpan(entryStart, awaySince, Date.now())
    awaySince = null
    if (!span) return

    asking = true
    try {
      await ask(deps, entry, entryStart, span)
    } catch (e) {
      deps.log?.("idle prompt failed", e)
    } finally {
      asking = false
    }
  }

  const timer = setInterval(() => void tick(), POLL_MS)
  // Coming back from sleep is the commonest way to be away; check immediately rather than
  // waiting out the poll interval.
  const onResume = () => void tick()
  powerMonitor.on("resume", onResume)
  powerMonitor.on("unlock-screen", onResume)

  return () => {
    clearInterval(timer)
    powerMonitor.off("resume", onResume)
    powerMonitor.off("unlock-screen", onResume)
  }
}

async function ask(deps: IdleWatchDeps, entry: TimeEntry, entryStart: number, span: AwaySpan): Promise<void> {
  const s = deps.strings()
  const minutes = Math.round(span.seconds / 60)
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: s.title,
    message: s.title,
    detail: s.body(minutes),
    buttons: [s.keep, s.discard],
    defaultId: 0,
    cancelId: 0, // dismissing keeps the time — never silently bill less than was tracked
  })
  if (response !== 1) return

  // The entry may have been stopped or switched while the dialog was open.
  const current = deps.running()
  if (!current || current.id !== entry.id || current.ended_at) return

  await deps.cut(entry.id, new Date(endAfterDiscard(entryStart, span)).toISOString())
}
