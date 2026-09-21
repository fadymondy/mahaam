/**
 * Idle handling for a running timer.
 *
 * The problem: someone starts a timer, walks away for forty minutes, and comes back to a timer
 * that has been billing the whole time. The fix is not to pause the timer — the server owns the
 * clock and a time entry is a start and an end, not a stopwatch that can be paused — but to let
 * the person cut the entry back to the moment they went away.
 *
 * Everything here is pure arithmetic over `powerMonitor.getSystemIdleTime()` readings, so it can
 * be tested without an OS. The Electron side only supplies the reading and performs the cut.
 */

/** Idle shorter than this is normal thinking time, not being away. */
export const DEFAULT_IDLE_THRESHOLD_S = 10 * 60

/**
 * When the current idle period began, or null if the person is not away yet.
 *
 * `idleSeconds` is what the OS reports: seconds since the last input. Below the threshold this
 * returns null rather than a timestamp, so a caller cannot accidentally treat two minutes of
 * reading the screen as being away.
 */
export function idleStartedAt(idleSeconds: number, now: number, threshold = DEFAULT_IDLE_THRESHOLD_S): number | null {
  if (!Number.isFinite(idleSeconds) || idleSeconds < threshold) return null
  return now - Math.floor(idleSeconds) * 1000
}

export interface AwaySpan {
  /** When the person went away (ms since epoch). */
  from: number
  /** When they came back (ms since epoch). */
  to: number
  /** Whole seconds between the two. */
  seconds: number
}

/**
 * The span to offer for discarding, clamped to the running entry so we never propose cutting time
 * that predates it.
 *
 * Returns null when there is nothing worth asking about: no entry, the person was not away long
 * enough, or the idle period began before the timer did (they started the timer *after* walking
 * away, so none of the idle time was billed).
 */
export function discardableSpan(
  entryStartedAt: number,
  idleStart: number | null,
  now: number,
  minSeconds = 60,
): AwaySpan | null {
  if (idleStart === null || !Number.isFinite(entryStartedAt)) return null
  const from = Math.max(idleStart, entryStartedAt)
  if (now <= from) return null
  const seconds = Math.floor((now - from) / 1000)
  return seconds >= minSeconds ? { from, to: now, seconds } : null
}

/**
 * Where a discarded span leaves the entry's end time.
 *
 * Cutting to `span.from` means the entry ends at the moment the person went away — which is the
 * whole point. Never returns a time before the entry started.
 */
export function endAfterDiscard(entryStartedAt: number, span: AwaySpan): number {
  return Math.max(entryStartedAt, span.from)
}
