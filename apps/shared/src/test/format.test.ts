import { describe, expect, it } from "vitest";
import { badge, clock, duration, elapsedSeconds, nextMinuteAt } from "../format";
import { rasterMark } from "../brand";

describe("format", () => {
  it("clock / duration / badge", () => {
    expect(clock(59)).toBe("0:59");
    expect(clock(3909)).toBe("1:05:09");
    expect(duration(3900)).toBe("1h 05m");
    expect(badge(7 * 60)).toBe("7m");
    expect(badge(65 * 60)).toBe("1:05");
    expect(badge(12 * 3600)).toBe("12h");
  });

  it("elapsedSeconds for running and stopped entries", () => {
    const start = "2026-01-01T00:00:00Z";
    expect(elapsedSeconds({ started_at: start, ended_at: null, duration_s: null }, Date.parse(start) + 90_500)).toBe(90);
    expect(elapsedSeconds({ started_at: start, ended_at: "2026-01-01T00:10:00Z", duration_s: 600 })).toBe(600);
  });

  it("nextMinuteAt is the running entry's next whole minute, where the badge changes", () => {
    const start = "2026-01-01T00:00:00Z";
    const t0 = Date.parse(start);
    const e = { started_at: start };
    expect(nextMinuteAt(e, t0)).toBe(t0 + 60_000);
    expect(nextMinuteAt(e, t0 + 59_999)).toBe(t0 + 60_000);
    expect(nextMinuteAt(e, t0 + 60_000)).toBe(t0 + 120_000);
    expect(nextMinuteAt(e, t0 + 61 * 60_000 + 5)).toBe(t0 + 62 * 60_000);
    // A start the device's clock has not reached yet still waits for the first minute.
    expect(nextMinuteAt(e, t0 - 5_000)).toBe(t0 + 60_000);
    // And at that instant the badge does read the next minute.
    expect(badge(elapsedSeconds({ ...e, ended_at: null, duration_s: null }, nextMinuteAt(e, t0 + 30_000)))).toBe("1m");
  });

  it("rasterMark paints the mark colours and leaves the rest transparent", () => {
    const px = rasterMark(100);
    const at = (x: number, y: number) => Array.from(px.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4));
    expect(at(40, 40)).toEqual([0x8c, 0x3f, 0xb5, 255]);
    expect(at(80, 40)).toEqual([0xc9, 0xa2, 0x27, 255]);
    expect(at(2, 2)[3]).toBe(0);
    expect(rasterMark(100, { dark: true })[(40 * 100 + 40) * 4]).toBe(0xb7);
  });
});
