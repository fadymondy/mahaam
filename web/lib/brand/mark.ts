// The Mahaam cube mark.
//
// TEMPORARY: the upstream entry in fadymondy.com-v2/web/lib/brand/marks.ts (PRODUCT_MARKS.managy)
// is being added separately. Once it lands, `npm run grid:sync` brings it into
// app/styles/grid-marks.ts — switch imports to that file and delete this one.
// The MarkSpec shape below is copied from marks.ts so the switch is a one-line change.

export type Cell = readonly [col: number, row: number]

export interface MarkSpec {
  name: string
  cells: readonly Cell[]
  /** Cells rendered in the accent colour instead of the body colour. */
  accentCells: readonly Cell[]
  body: string
  accent: string
  /** Body colour to use when rendered on a dark ground, if different. */
  bodyOnDark?: string
  actionOnDark?: string
}

export const MAHAAM_MARK: MarkSpec = {
  name: "Mahaam",
  cells: [
    [1, 0],
    [3, 0],
    [0, 1],
    [2, 1],
  ],
  accentCells: [[3, 0]],
  body: "#8C3FB5",
  accent: "#C9A227",
}
