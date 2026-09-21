import { describe, expect, it } from "vitest"

import { DEFAULT_IDLE_THRESHOLD_S, discardableSpan, endAfterDiscard, idleStartedAt } from "../idle"

const NOW = 1_800_000_000_000
const M = 60_000

describe("idle", () => {
  it("does not treat short idle as being away", () => {
    expect(idleStartedAt(0, NOW)).toBeNull()
    expect(idleStartedAt(5 * 60, NOW)).toBeNull()
    // exactly at the threshold counts as away
    expect(idleStartedAt(DEFAULT_IDLE_THRESHOLD_S, NOW)).toBe(NOW - DEFAULT_IDLE_THRESHOLD_S * 1000)
  })

  it("reports when the idle period began, not how long it has run", () => {
    expect(idleStartedAt(20 * 60, NOW)).toBe(NOW - 20 * M)
  })

  it("ignores nonsense readings rather than inventing a timestamp", () => {
    expect(idleStartedAt(Number.NaN, NOW)).toBeNull()
    expect(idleStartedAt(Number.POSITIVE_INFINITY, NOW)).toBeNull()
    expect(idleStartedAt(-1, NOW)).toBeNull()
  })

  it("clamps the span to the entry, so it never offers to cut time the timer never billed", () => {
    // Away for 30m, but the timer only started 10m ago: only those 10m were billed.
    const startedAt = NOW - 10 * M
    const span = discardableSpan(startedAt, NOW - 30 * M, NOW)!
    expect(span.from).toBe(startedAt)
    expect(span.seconds).toBe(600)
  })

  it("uses the idle start when the timer was already running", () => {
    const startedAt = NOW - 60 * M
    const span = discardableSpan(startedAt, NOW - 25 * M, NOW)!
    expect(span.from).toBe(NOW - 25 * M)
    expect(span.seconds).toBe(1500)
  })

  it("asks about nothing when the person was not really away", () => {
    expect(discardableSpan(NOW - 60 * M, null, NOW)).toBeNull()
    // below the minimum worth interrupting someone for
    expect(discardableSpan(NOW - 60 * M, NOW - 30_000, NOW)).toBeNull()
  })

  it("asks about nothing when the timer started after the person went away", () => {
    // Walked away at T-30m, started the timer at T-1m: nothing idle was billed.
    const startedAt = NOW - 60_000
    const span = discardableSpan(startedAt, NOW - 30 * M, NOW, 60)
    expect(span?.seconds).toBe(60)
    // and with a stricter minimum there is nothing to ask about
    expect(discardableSpan(startedAt, NOW - 30 * M, NOW, 120)).toBeNull()
  })

  it("cuts the entry back to the moment they went away", () => {
    const startedAt = NOW - 60 * M
    const span = discardableSpan(startedAt, NOW - 25 * M, NOW)!
    expect(endAfterDiscard(startedAt, span)).toBe(NOW - 25 * M)
  })

  it("never ends an entry before it started", () => {
    const startedAt = NOW - 5 * M
    const span = { from: NOW - 50 * M, to: NOW, seconds: 3000 }
    expect(endAfterDiscard(startedAt, span)).toBe(startedAt)
  })
})
