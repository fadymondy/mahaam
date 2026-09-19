// Marks each dist flavour with its module type so Node resolves .js correctly.
import { writeFileSync } from "node:fs";
writeFileSync("dist/esm/package.json", JSON.stringify({ type: "module" }) + "\n");
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
