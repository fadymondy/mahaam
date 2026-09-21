/**
 * Pomodoro is a *view* over a running time entry, not a second kind of timer.
 *
 * The server owns the clock: a time entry has a `started_at` and the client recomputes elapsed
 * time from it. Pomodoro keeps that property — given the elapsed seconds of the running entry it
 * derives which interval you are in and how long is left. Nothing here is persisted and nothing
 * changes the wire format, so a Pomodoro user and a stopwatch user produce identical time
 * entries, and switching the mode on or off mid-session cannot corrupt anything.
 *
 * A consequence worth knowing: because the phase is derived rather than stored, it survives a
 * reload, a reboot, or the app being killed, exactly like the underlying timer does.
 */

export interface PomodoroConfig {
  /** Length of a focus interval. */
  workMinutes: number
  /** Short break after each focus interval. */
  breakMinutes: number
  /** Longer break after `longBreakEvery` focus intervals. */
  longBreakMinutes: number
  /** How many focus intervals before the long break. */
  longBreakEvery: number
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
}

export type PomodoroPhase = "work" | "break" | "long-break"

export interface PomodoroState {
  phase: PomodoroPhase
  /** 1-based focus interval within the current cycle. */
  round: number
  /** Focus intervals finished since the entry started. */
  completedWork: number
  /** Seconds already spent in this phase. */
  elapsed: number
  /** Seconds left in this phase. */
  remaining: number
  /** Length of this phase, in seconds. */
  length: number
}

/** A config is usable only if every interval is a positive whole number of minutes. */
export function isValidPomodoro(cfg: PomodoroConfig): boolean {
  const positive = (n: number) => Number.isFinite(n) && n > 0
  return (
    positive(cfg.workMinutes) &&
    positive(cfg.breakMinutes) &&
    positive(cfg.longBreakMinutes) &&
    positive(cfg.longBreakEvery) &&
    Number.isInteger(cfg.longBreakEvery)
  )
}

/**
 * Which interval `elapsed` seconds into a running entry falls in.
 *
 * Returns null for a config that cannot produce a cycle, rather than guessing — a zero-length
 * interval would otherwise loop forever. Callers treat null as "Pomodoro off".
 */
export function pomodoroState(elapsed: number, cfg: PomodoroConfig = DEFAULT_POMODORO): PomodoroState | null {
  if (!isValidPomodoro(cfg)) return null

  const work = Math.round(cfg.workMinutes * 60)
  const short = Math.round(cfg.breakMinutes * 60)
  const long = Math.round(cfg.longBreakMinutes * 60)
  const every = cfg.longBreakEvery

  // One cycle is: (work, short) repeated every-1 times, then work, then the long break.
  const cycle = every * work + (every - 1) * short + long
  const total = Math.max(0, Math.floor(elapsed))
  const cycles = Math.floor(total / cycle)
  let t = total % cycle

  for (let round = 1; round <= every; round++) {
    if (t < work) {
      return {
        phase: "work",
        round,
        completedWork: cycles * every + (round - 1),
        elapsed: t,
        remaining: work - t,
        length: work,
      }
    }
    t -= work

    const isLast = round === every
    const len = isLast ? long : short
    if (t < len) {
      return {
        phase: isLast ? "long-break" : "break",
        round,
        completedWork: cycles * every + round,
        elapsed: t,
        remaining: len - t,
        length: len,
      }
    }
    t -= len
  }

  // Unreachable: the loop covers the whole cycle. Kept so a future config change fails loudly
  // rather than silently returning a wrong phase.
  return null
}

/** True on the exact second a phase ends — the moment to notify. */
export function pomodoroPhaseEnding(elapsed: number, cfg: PomodoroConfig = DEFAULT_POMODORO): boolean {
  const s = pomodoroState(elapsed, cfg)
  return s !== null && s.remaining === s.length && s.elapsed === 0 && elapsed > 0
}
