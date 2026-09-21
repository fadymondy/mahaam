"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import type { NextItem } from "../../types"
import { Input } from "./input"

/**
 * Cmd/Ctrl+K jump-to-item.
 *
 * Deliberately filters what the panel already has rather than querying: the list is the same
 * "Next up" set the user is looking at, so opening the palette is instant and works offline. It
 * is a way to reach an item by typing instead of scrolling, not a search of the whole workspace.
 */

export interface PaletteStrings {
  placeholder: string
  empty: string
  hint: string
}

/** Subsequence match, so "buttmig" finds "Migrate the buttons". Cheap and forgiving of word order. */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase().replace(/\s+/g, "")
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i++
    if (i === n.length) return true
  }
  return i === n.length
}

export function filterItems(items: NextItem[], query: string, limit = 8): NextItem[] {
  const q = query.trim()
  if (!q) return items.slice(0, limit)
  return items.filter((i) => fuzzyMatch(`${i.key} ${i.title} ${i.projectName ?? ""}`, q)).slice(0, limit)
}

export function Palette({
  items,
  strings,
  onPick,
  onClose,
}: {
  items: NextItem[]
  strings: PaletteStrings
  onPick: (item: NextItem) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const shown = useMemo(() => filterItems(items, query), [items, query])

  useEffect(() => inputRef.current?.focus(), [])
  // A stale index after filtering would run the wrong item on Enter.
  useEffect(() => setActive(0), [query])

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = shown[active]
      if (item) onPick(item)
    }
  }

  return (
    <div className="mgy-palette-scrim" onMouseDown={onClose} role="presentation">
      <div className="mgy-palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={strings.placeholder}>
        <Input
          ref={inputRef}
          value={query}
          placeholder={strings.placeholder}
          aria-label={strings.placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={keys}
        />
        {shown.length === 0 ? (
          <p className="mgy-muted mgy-palette-empty">{strings.empty}</p>
        ) : (
          <ul className="mgy-palette-list" role="listbox">
            {shown.map((item, i) => (
              <li key={item.kind + item.key} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={i === active ? "mgy-palette-row mgy-palette-row-active" : "mgy-palette-row"}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(item)}
                >
                  <span className="mgy-mono mgy-muted">{item.key}</span> <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mgy-muted mgy-palette-hint">{strings.hint}</p>
      </div>
    </div>
  )
}
