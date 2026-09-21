import { describe, expect, it } from "vitest"

import { groupByStatus, searchIssues } from "../ui/components/issues-view"
import type { Issue } from "../types"

const iss = (key: string, status: string, title = key, state = "open"): Issue =>
  ({ key, status, title, state } as Issue)

describe("groupByStatus", () => {
  it("orders groups by what you are working on, not alphabetically", () => {
    const groups = groupByStatus([iss("A", "backlog"), iss("B", "in_progress"), iss("C", "todo"), iss("D", "in_review")])
    expect(groups.map((g) => g.status)).toEqual(["in_progress", "in_review", "todo", "backlog"])
  })

  it("omits empty groups rather than showing headings with nothing under them", () => {
    const groups = groupByStatus([iss("A", "todo")])
    expect(groups.map((g) => g.status)).toEqual(["todo"])
  })

  it("excludes closed issues — this is a working view, not an archive", () => {
    const groups = groupByStatus([iss("A", "done", "A", "closed"), iss("B", "todo")])
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(["B"])
  })

  it("still shows an unrecognised status instead of dropping the issue", () => {
    // A status added server-side must not make issues vanish from the panel.
    const groups = groupByStatus([iss("A", "todo"), iss("B", "some_new_stage")])
    expect(groups.map((g) => g.status)).toEqual(["todo", "some_new_stage"])
    expect(groups.flatMap((g) => g.items.map((i) => i.key)).sort()).toEqual(["A", "B"])
  })

  it("treats a blank status as backlog", () => {
    const groups = groupByStatus([iss("A", "")])
    expect(groups[0]!.status).toBe("backlog")
  })

  it("keeps several issues within one group", () => {
    const groups = groupByStatus([iss("A", "todo"), iss("B", "todo")])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items).toHaveLength(2)
  })
})

describe("searchIssues", () => {
  const items = [iss("MH-1", "todo", "Migrate the buttons"), iss("MH-2", "todo", "Offline queue")]

  it("matches the key so typing an issue number finds it", () => {
    expect(searchIssues(items, "mh-2").map((i) => i.key)).toEqual(["MH-2"])
  })

  it("matches the title, case-insensitively", () => {
    expect(searchIssues(items, "BUTTONS").map((i) => i.key)).toEqual(["MH-1"])
  })

  it("returns everything for a blank or whitespace query", () => {
    expect(searchIssues(items, "   ")).toHaveLength(2)
  })

  it("returns nothing when nothing matches", () => {
    expect(searchIssues(items, "zzz")).toEqual([])
  })
})
