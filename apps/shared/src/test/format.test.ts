import { describe, expect, it } from "vitest";
import { badge, clock, duration, elapsedSeconds } from "../format";
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

  it("rasterMark paints the mark colours and leaves the rest transparent", () => {
    const px = rasterMark(100);
    const at = (x: number, y: number) => Array.from(px.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4));
    expect(at(40, 40)).toEqual([0x8c, 0x3f, 0xb5, 255]);
    expect(at(80, 40)).toEqual([0xc9, 0xa2, 0x27, 255]);
    expect(at(2, 2)[3]).toBe(0);
    expect(rasterMark(100, { dark: true })[(40 * 100 + 40) * 4]).toBe(0xb7);
  });
});
