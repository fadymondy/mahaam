import { describe, expect, it } from "vitest"

import { filterItems, fuzzyMatch } from "../ui/components/palette"
import type { NextItem } from "../types"

const item = (key: string, title: string, projectName = "Launch"): NextItem =>
  ({ kind: "issue", key, title, projectId: "p", projectName, doing: false, priority: "none", issue: {} as never })

describe("fuzzyMatch", () => {
  it("matches a plain substring", () => {
    expect(fuzzyMatch("Migrate the buttons", "buttons")).toBe(true)
  })

  it("matches characters in order with gaps, so partial words still find it", () => {
    expect(fuzzyMatch("Migrate the buttons", "migbut")).toBe(true)
    expect(fuzzyMatch("Migrate the buttons", "mgbtn")).toBe(true)
  })

  it("ignores case and spaces in the query", () => {
    expect(fuzzyMatch("Migrate the buttons", "MIG BUT")).toBe(true)
  })

  it("rejects characters that are out of order", () => {
    expect(fuzzyMatch("Migrate the buttons", "buttonsmigrate")).toBe(false)
  })

  it("an empty query matches everything", () => {
    expect(fuzzyMatch("anything", "")).toBe(true)
  })
})

describe("filterItems", () => {
  const items = [item("MH-1", "Migrate the buttons"), item("MH-2", "Tray e2e seed issue"), item("MH-3", "Offline queue", "Core")]

  it("returns everything up to the limit when there is no query", () => {
    expect(filterItems(items, "").map((i) => i.key)).toEqual(["MH-1", "MH-2", "MH-3"])
    expect(filterItems(items, "", 2)).toHaveLength(2)
  })

  it("matches on the key, so typing an issue number finds it", () => {
    expect(filterItems(items, "MH-3").map((i) => i.key)).toEqual(["MH-3"])
  })

  it("matches on the title", () => {
    expect(filterItems(items, "seed").map((i) => i.key)).toEqual(["MH-2"])
  })

  it("matches on the project name", () => {
    expect(filterItems(items, "core").map((i) => i.key)).toEqual(["MH-3"])
  })

  it("returns nothing when nothing matches, rather than everything", () => {
    expect(filterItems(items, "zzzzz")).toEqual([])
  })

  it("caps the list so the palette cannot grow unbounded", () => {
    const many = Array.from({ length: 50 }, (_, i) => item(`MH-${i}`, "Task " + i))
    expect(filterItems(many, "task").length).toBeLessThanOrEqual(8)
  })
})
