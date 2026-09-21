"use client"

import { useMemo, useState } from "react"

import type { Issue } from "../../types"
import { Button } from "./button"
import { Input } from "./input"

/**
 * The issues list for the panel.
 *
 * Grouped by workflow stage rather than shown flat, because the panel is 380px wide and a flat
 * list of forty issues tells you nothing at a glance. Closed issues are excluded by default —
 * this is a working view, not an archive.
 *
 * Opening an issue hands off to the web app: the panel has no room for a detail pane with a
 * markdown body, comments and inline edit, and half of one would be worse than a clean hand-off.
 */

export interface IssuesStrings {
  title: string
  back: string
  search: string
  empty: string
  status: Record<string, string>
}

/** Working order, not alphabetical: what you are doing first, what is waiting on you last. */
const ORDER = ["in_progress", "in_review", "waiting_approval", "todo", "backlog"] as const

export function groupByStatus(issues: Issue[]): Array<{ status: string; items: Issue[] }> {
  const open = issues.filter((i) => i.state !== "closed")
  const byStatus = new Map<string, Issue[]>()
  for (const i of open) {
    const k = i.status || "backlog"
    const list = byStatus.get(k)
    if (list) list.push(i)
    else byStatus.set(k, [i])
  }
  const known = ORDER.filter((s) => byStatus.has(s)).map((s) => ({ status: s as string, items: byStatus.get(s)! }))
  // Anything with a status we do not know about still has to appear, or issues silently vanish.
  const rest = [...byStatus.keys()].filter((k) => !ORDER.includes(k as (typeof ORDER)[number])).sort()
  return [...known, ...rest.map((s) => ({ status: s, items: byStatus.get(s)! }))]
}

export function searchIssues(issues: Issue[], q: string): Issue[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return issues
  return issues.filter((i) => `${i.key} ${i.title}`.toLowerCase().includes(needle))
}

export function IssuesView({
  issues,
  strings,
  onBack,
  onOpen,
}: {
  issues: Issue[] | null
  strings: IssuesStrings
  onBack: () => void
  onOpen: (issue: Issue) => void
}) {
  const [q, setQ] = useState("")
  const groups = useMemo(() => groupByStatus(searchIssues(issues ?? [], q)), [issues, q])
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <section className="mgy-page">
      <div className="mgy-bar">
        <Button variant="link" className="h-auto p-0 justify-start" onClick={onBack}>
          ← {strings.back}
        </Button>
        <span className="mgy-spacer" />
        <span className="mgy-muted mgy-mono">{total}</span>
      </div>
      <Input value={q} placeholder={strings.search} aria-label={strings.search} onChange={(e) => setQ(e.target.value)} />
      {total === 0 ? (
        <p className="mgy-muted">{strings.empty}</p>
      ) : (
        groups.map((g) => (
          <div key={g.status} className="mgy-section">
            <h2 className="mgy-h">
              {strings.status[g.status] ?? g.status} <span className="mgy-mono mgy-muted">{g.items.length}</span>
            </h2>
            <ul className="mgy-list">
              {g.items.map((i) => (
                <li key={i.key} className="mgy-row">
                  <button type="button" className="mgy-row-main mgy-palette-row" onClick={() => onOpen(i)}>
                    <span className="mgy-mono mgy-muted">{i.key}</span> <span className="mgy-title">{i.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
