import { readFileSync } from "node:fs"
import { join } from "node:path"

import { palettes } from "../tokens"

/**
 * src/theme/tokens.ts is hand-copied hex. `make grid-check` guards web/ against the grid source
 * but nothing covered mobile, so these values could drift from the rest of the product and no
 * build would notice — the colours would simply be slightly wrong on a phone.
 *
 * Adopting grid-native wholesale is a restructure (it brings its own session, api, i18n and prefs
 * layers), so this does the cheap half: read the same CSS the web app compiles and assert the
 * hexes still agree.
 */

const styles = join(__dirname, "..", "..", "..", "..", "..", "web", "app", "styles")
// Order matters: mahaam-brand.css overrides the grid's own brand, exactly as the web app imports
// them. Each file is scoped separately — concatenating first and splitting once would push the
// whole brand override into the dark scope, leaving light with the unbranded values.
const SHEETS = ["grid-tokens.css", "mahaam-brand.css"].map((f) => readFileSync(join(styles, f), "utf8"))

/**
 * Values for one theme. Both files declare `:root` (light) first and a dark block after, and
 * mahaam-brand.css overrides the grid's own brand — so the *last* declaration of a variable in
 * each half is the effective one, which is what `last()` picks.
 */
function tokens(theme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {}
  for (const css of SHEETS) {
    // Anchored to the start of a line. An unanchored search matches the file's own comment about
    // putting `.dark` on <html>, which sits above every declaration — that silently emptied the
    // light scope and made every comparison below vacuous.
    const marker = css.search(/^\.dark\b|^\[data-theme=["']?dark/m)
    const scope = marker === -1 ? (theme === "light" ? css : "") : theme === "light" ? css.slice(0, marker) : css.slice(marker)
    for (const m of scope.matchAll(/--grid-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
      out[m[1]!] = m[2]!.toLowerCase() // later declarations win, so the brand override sticks
    }
  }
  return out
}

/** mobile palette key -> grid custom property. Keys with no grid equivalent are not listed. */
const MAP: Record<string, string> = {
  bg: "bg",
  card: "card",
  line: "line",
  soft: "soft",
  fg: "fg",
  body: "body",
  muted: "muted",
  brand: "brand",
  // Mobile uses these as text colours, so they map to the -text variants rather than the fills.
  ok: "ok-text",
  danger: "danger-text",
  warn: "warn-text",
}

describe("theme tokens match the grid", () => {
  it("parses the grid stylesheets at all", () => {
    const light = tokens("light")
    expect(Object.keys(light).length).toBeGreaterThan(8)
    expect(light.bg).toMatch(/^#[0-9a-f]{6}$/)
  })

  for (const theme of ["light", "dark"] as const) {
    it(`${theme} palette has not drifted from grid-tokens.css / mahaam-brand.css`, () => {
      const grid = tokens(theme)
      const mine = palettes[theme] as Record<string, string>
      const drifted: string[] = []
      for (const [key, cssVar] of Object.entries(MAP)) {
        const expected = grid[cssVar]
        if (!expected) continue // not declared for this theme; nothing to compare
        if (mine[key]!.toLowerCase() !== expected) drifted.push(`${key}: ${mine[key]} !== --grid-${cssVar} ${expected}`)
      }
      expect(drifted).toEqual([])
    })
  }
})
