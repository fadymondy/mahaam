// Bundles the main process and the preload to CommonJS (the sandboxed preload must be one file).
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const opts = {
  entryPoints: { main: "src/main/main.ts", preload: "src/main/preload.ts", "make-icons": "src/main/make-icons.ts" },
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
};
if (watch) await (await context(opts)).watch();
else await build(opts);
