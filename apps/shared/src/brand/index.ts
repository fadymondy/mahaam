// The Mahaam mark (Mahaam brand: https://managy.fadymondy.com/en/brand). Never recolour or redraw it: the only
// variant is the dark-ground body colour (#8C3FB5 → #B784D6).
export const BRAND = {
  brand: "#8C3FB5",
  brandOnDark: "#B784D6",
  accent: "#C9A227",
  ink: "#0B1429",
  paper: "#F0EBE1",
} as const;

/** The mark's squares on a 100×100 grid: [x, y, size, part]. */
export const MARK_RECTS: ReadonlyArray<readonly [number, number, number, "body" | "accent"]> = [
  [29, 29, 21, "body"],
  [71, 29, 21, "accent"],
  [8, 50, 21, "body"],
  [50, 50, 21, "body"],
];

export function markSvg(opts: { dark?: boolean; size?: number; title?: string } = {}): string {
  const body = opts.dark ? BRAND.brandOnDark : BRAND.brand;
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const title = opts.title ? `<title>${opts.title}</title>` : "";
  const rects = MARK_RECTS.map(([x, y, s, part]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${part === "body" ? body : BRAND.accent}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${size} role="img">${title}${rects}</svg>`;
}

/**
 * Rasterises the mark into an RGBA buffer (for tray icons and app icons, where SVG is not
 * accepted). `dot` adds a small status dot in the empty bottom-right corner — beside the mark,
 * never on it.
 */
export function rasterMark(
  size: number,
  opts: { dark?: boolean; dot?: string | null; background?: string | null; padding?: number; /** One colour for every cell (a macOS template image: black, tinted by the system). */ mono?: string } = {},
): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
  const pad = opts.padding ?? 0;
  const scale = (size - 2 * pad) / 100;
  const fill = (x0: number, y0: number, x1: number, y1: number, color: string, circle = false) => {
    const [r, g, b] = hex(color);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rad = (x1 - x0) / 2;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) {
        // coverage by 4×4 supersampling keeps small sizes crisp without a raster library
        let cov = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          const fx = x + (sx + 0.5) / 4, fy = y + (sy + 0.5) / 4;
          const inside = circle ? (fx - cx) ** 2 + (fy - cy) ** 2 <= rad * rad : fx >= x0 && fx < x1 && fy >= y0 && fy < y1;
          if (inside) cov++;
        }
        if (!cov) continue;
        const a = cov / 16, i = (y * size + x) * 4;
        const da = px[i + 3]! / 255, oa = a + da * (1 - a);
        px[i] = Math.round((r * a + px[i]! * da * (1 - a)) / oa);
        px[i + 1] = Math.round((g * a + px[i + 1]! * da * (1 - a)) / oa);
        px[i + 2] = Math.round((b * a + px[i + 2]! * da * (1 - a)) / oa);
        px[i + 3] = Math.round(oa * 255);
      }
    }
  };
  if (opts.background) fill(0, 0, size, size, opts.background);
  const body = opts.mono ?? (opts.dark ? BRAND.brandOnDark : BRAND.brand);
  const accent = opts.mono ?? BRAND.accent;
  for (const [x, y, s, part] of MARK_RECTS) fill(pad + x * scale, pad + y * scale, pad + (x + s) * scale, pad + (y + s) * scale, part === "body" ? body : accent);
  if (opts.dot) fill(pad + 74 * scale, pad + 74 * scale, pad + 98 * scale, pad + 98 * scale, opts.dot, true);
  return px;
}
