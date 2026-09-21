// Regenerates src/api/openapi.d.ts from the Go API's OpenAPI document.
//
// Same approach as apps/shared: shell out to `go run ./cmd/api openapi`, which prints the spec
// from the compiled handlers — no server, no port, no auth. apps/mobile sits outside the apps/
// npm workspace (its own lockfile), so it needs its own copy of this rather than importing
// @mahaam/client.
//
// Override with MAHAAM_OPENAPI=<url|path> (CI passes the spec the api job already built).
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))        // apps/mobile/scripts
const repoRoot = resolve(here, "..", "..", "..")

let src = process.env.MAHAAM_OPENAPI
let tmp
if (!src) {
  const yaml = execFileSync("go", ["run", "./cmd/api", "openapi"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
  tmp = mkdtempSync(join(tmpdir(), "mahaam-openapi-"))
  src = join(tmp, "openapi.yaml")
  writeFileSync(src, yaml)
}
try {
  execFileSync("npx", ["openapi-typescript", src, "-o", "src/api/openapi.d.ts"], { cwd: resolve(here, ".."), stdio: "inherit", shell: true })
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
}
