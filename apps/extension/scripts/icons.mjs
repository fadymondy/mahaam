// Writes public/icons/{16,32,48,128}.png from the mark (shared rasteriser + PNG encoder).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });
const out = "node_modules/.cache/mahaam-icons.mjs";
await build({
  stdin: {
    contents: `
      import { writeFileSync } from "node:fs";
      import { rasterMark } from "@mahaam/client/brand";
      import { encodePng } from "@mahaam/client/brand/png";
      for (const s of [16, 32, 48, 128]) writeFileSync("public/icons/" + s + ".png", encodePng(rasterMark(s), s, s));
    `,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "warning",
});
await import(new URL("../" + out, import.meta.url).href);
console.log("wrote public/icons/*.png");
