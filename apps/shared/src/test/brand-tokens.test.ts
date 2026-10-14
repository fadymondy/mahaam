import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The third copy of the design tokens.
 *
 * `apps/shared/src/ui/grid/grid-tokens.css` is the source, synced from fadymondy.com-v2.
 * `apps/mobile/src/theme/tokens.ts` is hand-copied hex, guarded by its own drift test. And
 * `apps/shared/src/brand/tokens.css` — what the tray popover and the extension popup actually
 * render with — had nothing watching it at all.
 *
 * Nothing syncs these. A colour changed in the web app leaves the desktop and the extension
 * quietly wrong, and no build fails: the popover just does not match the product any more, which
 * is the kind of thing a person notices long before a test does.
 *
 * The rule is "everything you declare must agree", not "you must declare everything" — this file
 * is deliberately trimmed to what the two small surfaces use.
 */

const here = join(__dirname, "..", "..")
// The web app moved to Nasaq tokens and no longer ships web/app/styles/grid-tokens.css, so the
// source is now the grid copy synced from fadymondy.com-v2 (apps/shared/src/ui/grid) plus the
// repo-owned Mahaam brand block the desktop app imports.
const SOURCES = [
  join(here, "src", "ui", "grid", "grid-tokens.css"),
  join(here, "..", "desktop", "src", "renderer", "styles", "mahaam-brand.css"),
]

// Order matters, and matches how they are imported: mahaam-brand.css overrides the grid's own
// brand. Read separately rather than concatenated — joining them first and splitting on the
// dark selector once would push the whole brand override into the dark scope, leaving light
// holding the unbranded values and the comparison passing for the wrong reason.
const SHEETS = SOURCES.map((f) => readFileSync(f, "utf8"))
const OURS = readFileSync(join(here, "src", "brand", "tokens.css"), "utf8")

/**
 * Splits a stylesheet into its light half and its dark half.
 *
 * Both files declare `:root` first and a dark block after. Two details decide whether this works:
 *
 *  - The selector must be matched at the start of a line. An unanchored search for `.dark` also
 *    hits the prose in the file's own header comment, and the split then lands in the wrong
 *    place — which is how an earlier version of the mobile guard passed while comparing nothing.
 *  - The `{` may be on a *later* line: the web sheets open with `.dark,` and put
 *    `[data-theme="dark"] {` underneath. Requiring the brace on the same line silently finds no
 *    dark block at all, leaves the dark half empty, and reports every token as missing.
 */
function halves(css: string): { light: string; dark: string } {
  const at = css.search(/^\s*(\.dark\b|\[data-theme="dark"\])/m)
  return at < 0 ? { light: css, dark: "" } : { light: css.slice(0, at), dark: css.slice(at) }
}

/** The effective value of each `--grid-*`: the last declaration wins, as in the cascade. */
function declared(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) out[m[1]!] = m[2]!.trim()
  return out
}

function source(theme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {}
  for (const css of SHEETS) Object.assign(out, declared(halves(css)[theme]))
  return out
}

describe("apps/shared brand tokens", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      const web = source(theme)
      const ours = declared(halves(OURS)[theme])

      it("declares something to compare", () => {
        // Guards the guard: if the parse or the split breaks, every assertion below would pass
        // over an empty set and this file would look green while checking nothing.
        expect(Object.keys(ours).length).toBeGreaterThan(10)
        expect(Object.keys(web).length).toBeGreaterThan(10)
      })

      it("matches the web app's values", () => {
        const drifted: string[] = []
        for (const [name, value] of Object.entries(ours)) {
          const expected = web[name]
          if (expected === undefined) continue // covered by the next test
          if (expected.toLowerCase() !== value.toLowerCase()) {
            drifted.push(`${name}: ours ${value}, web ${expected}`)
          }
        }
        expect(drifted, `run \`npm run grid:sync\` in web/ and copy the changed values across`).toEqual([])
      })

      it("declares nothing the web app does not", () => {
        // A token that exists only here is either a typo or an invention. Both end with the
        // popover drifting from the product, which is the thing this file exists to stop.
        const unknown = Object.keys(ours).filter((k) => web[k] === undefined)
        expect(unknown).toEqual([])
      })
    })
  }
})
