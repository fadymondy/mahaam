// Regenerates src/openapi.d.ts from a running Mahaam API (default: the dev API on :8120).
// Usage: MAHAAM_OPENAPI=https://console.mahaam.app/openapi.json npm run gen:types
import { execFileSync } from "node:child_process";
const src = process.env.MAHAAM_OPENAPI || "http://localhost:8120/openapi.json";
execFileSync("npx", ["openapi-typescript", src, "-o", "src/openapi.d.ts"], { stdio: "inherit", shell: true });
