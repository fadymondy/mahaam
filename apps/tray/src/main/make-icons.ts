// Writes build/icon.png (1024², the mark on the ivory ground) for electron-builder, which derives
// the .ico / .icns / Linux sizes from it. Run by `npm run build`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND, rasterMark } from "@mahaam/client/brand";
import { encodePng } from "@mahaam/client/brand/png";

const size = 1024;
const out = join(process.cwd(), "build");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "icon.png"), encodePng(rasterMark(size, { background: BRAND.paper, padding: 120 }), size, size));
console.log("wrote build/icon.png");
