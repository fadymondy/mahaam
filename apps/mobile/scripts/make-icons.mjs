// Renders the Mahaam mark (four squares on a 100×100 grid, see /en/brand) into the PNG app icons,
// adaptive-icon layers, splash images and favicons for both variants. No dependencies: the mark is
// axis-aligned rectangles, so we paint an RGBA buffer and encode the PNG with zlib ourselves.
//
//   node scripts/make-icons.mjs      → assets/brand/{team,client}-*.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "brand");
mkdirSync(out, { recursive: true });

const BRAND = "#8C3FB5";
const BRAND_DARK = "#B784D6"; // the mark's body on dark grounds
const ACCENT = "#C9A227";
const INK = "#0B1429";
const PAPER = "#F0EBE1";

// [x, y, w, h, role] on the 100×100 viewBox.
const MARK = [
  [29, 29, 21, 21, "body"],
  [71, 29, 21, 21, "accent"],
  [8, 50, 21, 21, "body"],
  [50, 50, 21, 21, "body"],
];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Paint the mark scaled into `scale` of the canvas (centred), on `bg` (null = transparent). */
function render(size, { bg, body, accent, scale = 0.8, mono }) {
  const buf = Buffer.alloc(size * size * 4);
  if (bg) {
    const c = hex(bg);
    for (let i = 0; i < size * size; i++) c.forEach((v, j) => (buf[i * 4 + j] = v));
  }
  // The mark's bounding box is x 8..92, y 29..71; centre it.
  const unit = (size * scale) / 100;
  const offX = size / 2 - 50 * unit;
  const offY = size / 2 - 50 * unit;
  for (const [x, y, w, h, role] of MARK) {
    const c = hex(mono ?? (role === "accent" ? accent : body));
    const x0 = Math.round(offX + x * unit), x1 = Math.round(offX + (x + w) * unit);
    const y0 = Math.round(offY + y * unit), y1 = Math.round(offY + (y + h) * unit);
    for (let py = Math.max(0, y0); py < Math.min(size, y1); py++)
      for (let px = Math.max(0, x0); px < Math.min(size, x1); px++) c.forEach((v, j) => (buf[(py * size + px) * 4 + j] = v));
  }
  return png(size, buf);
}

// One app (MH-418): the mark on Paper. (Light / dark / tinted variants are MH-339.)
const variants = {
  mahaam: { bg: PAPER, body: BRAND, accent: ACCENT },
};

for (const [name, v] of Object.entries(variants)) {
  const w = (file, data) => writeFileSync(join(out, `${name}-${file}.png`), data);
  w("icon", render(1024, { ...v, scale: 0.84 }));
  // Android adaptive icon: the foreground must sit inside the 66% safe zone.
  w("adaptive-fg", render(1024, { ...v, bg: null, scale: 0.6 }));
  w("adaptive-bg", render(1024, { ...v, body: v.bg, accent: v.bg, scale: 0 }));
  w("adaptive-mono", render(1024, { ...v, bg: null, scale: 0.6, mono: "#FFFFFF" }));
  w("splash", render(512, { ...v, body: BRAND, bg: null, scale: 0.9 }));
  w("splash-dark", render(512, { ...v, body: BRAND_DARK, bg: null, scale: 0.9 }));
  w("favicon", render(48, { ...v, scale: 0.9 }));
}
console.log("icons written to", out);
