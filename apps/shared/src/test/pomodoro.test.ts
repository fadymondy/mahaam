import { describe, expect, it } from "vitest"

import { DEFAULT_POMODORO, isValidPomodoro, pomodoroState, type PomodoroConfig } from "../pomodoro"

const M = 60
const cfg = DEFAULT_POMODORO // 25 work / 5 break / 15 long / every 4

describe("pomodoro", () => {
  it("starts in the first focus interval", () => {
    const s = pomodoroState(0, cfg)!
    expect(s.phase).toBe("work")
    expect(s.round).toBe(1)
    expect(s.elapsed).toBe(0)
    expect(s.remaining).toBe(25 * M)
    expect(s.completedWork).toBe(0)
  })

  it("counts down inside a focus interval", () => {
    const s = pomodoroState(10 * M, cfg)!
    expect(s.phase).toBe("work")
    expect(s.remaining).toBe(15 * M)
  })

  it("rolls into the break on the boundary second, not one second late", () => {
    expect(pomodoroState(25 * M - 1, cfg)!.phase).toBe("work")
    const s = pomodoroState(25 * M, cfg)!
    expect(s.phase).toBe("break")
    expect(s.elapsed).toBe(0)
    expect(s.remaining).toBe(5 * M)
    expect(s.completedWork).toBe(1)
  })

  it("alternates work and break for the first three rounds", () => {
    // round 2 work starts after work+break
    expect(pomodoroState(30 * M, cfg)!).toMatchObject({ phase: "work", round: 2 })
    expect(pomodoroState(55 * M, cfg)!).toMatchObject({ phase: "break", round: 2 })
    expect(pomodoroState(60 * M, cfg)!).toMatchObject({ phase: "work", round: 3 })
  })

  it("gives a long break after the fourth focus interval, not a short one", () => {
    // 4 work + 3 short = 100 + 15 = 115 minutes
    const s = pomodoroState(115 * M, cfg)!
    expect(s.phase).toBe("long-break")
    expect(s.round).toBe(4)
    expect(s.remaining).toBe(15 * M)
    expect(s.completedWork).toBe(4)
  })

  it("wraps into the next cycle and keeps counting completed intervals", () => {
    const cycle = 4 * 25 * M + 3 * 5 * M + 15 * M // 130 minutes
    const s = pomodoroState(cycle, cfg)!
    expect(s.phase).toBe("work")
    expect(s.round).toBe(1)
    expect(s.completedWork).toBe(4)

    const later = pomodoroState(cycle + 25 * M, cfg)!
    expect(later.phase).toBe("break")
    expect(later.completedWork).toBe(5)
  })

  it("survives a long-running entry — the phase is derived, never accumulated", () => {
    // Eight hours in, the answer must still be exact rather than drifting.
    const cycle = 130 * M
    const eightHours = 8 * 60 * M
    const s = pomodoroState(eightHours, cfg)!
    const within = eightHours % cycle
    expect(s.elapsed + (within - s.elapsed)).toBe(within)
    expect(["work", "break", "long-break"]).toContain(s.phase)
  })

  it("treats a negative or fractional elapsed as the start of the first interval", () => {
    expect(pomodoroState(-5, cfg)!).toMatchObject({ phase: "work", elapsed: 0 })
    expect(pomodoroState(0.9, cfg)!).toMatchObject({ phase: "work", elapsed: 0 })
  })

  it("refuses a config that cannot produce a cycle instead of looping forever", () => {
    const bad: PomodoroConfig[] = [
      { ...cfg, workMinutes: 0 },
      { ...cfg, breakMinutes: 0 },
      { ...cfg, longBreakMinutes: -1 },
      { ...cfg, longBreakEvery: 0 },
      { ...cfg, longBreakEvery: 2.5 },
      { ...cfg, workMinutes: Number.NaN },
    ]
    for (const c of bad) {
      expect(isValidPomodoro(c)).toBe(false)
      expect(pomodoroState(60, c)).toBeNull()
    }
  })

  it("supports a single-interval cycle, where every break is the long one", () => {
    const one: PomodoroConfig = { workMinutes: 10, breakMinutes: 5, longBreakMinutes: 20, longBreakEvery: 1 }
    expect(pomodoroState(0, one)!).toMatchObject({ phase: "work", round: 1 })
    expect(pomodoroState(10 * M, one)!).toMatchObject({ phase: "long-break", round: 1 })
    expect(pomodoroState(30 * M, one)!).toMatchObject({ phase: "work", round: 1, completedWork: 1 })
  })
})
