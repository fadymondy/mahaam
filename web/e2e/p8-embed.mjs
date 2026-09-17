// P7 embed widget, end-to-end in a real browser: load the IIFE on a page whose
// origin is an ALLOWED origin of a project's public key, open the dialog, and
// submit — the widget captures a screenshot + console/network and POSTs to the
// public /api/feedback/embed, creating a source=embed issue in the project.
//
//   cd web && node e2e/p8-embed.mjs
//
// The "throwaway page" is served from the web origin (127.0.0.1:3010) so its
// Origin header matches the key's allowlist; the loader + endpoint are on :8110.
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const API = process.env.API_ORIGIN ?? "http://127.0.0.1:8110"
const here = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(here, "shots")
mkdirSync(SHOTS, { recursive: true })

const assert = (c, m) => { if (!c) throw new Error(m); console.log("✓", m) }

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "managy-p8e-")), {
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: ["--disable-extensions", "--no-first-run"],
})
const P = ctx.pages()[0] ?? (await ctx.newPage())
P.on("pageerror", (e) => console.error("pageerror:", e))
await P.goto(`${WEB}/en/login`, { waitUntil: "load" })

const stamp = Date.now().toString(36)
const setup = await P.evaluate(async ({ stamp, WEB }) => {
  const j = async (r) => { const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${r.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
  await call("POST", "/api/auth/register", { email: `p8-embed-${stamp}@example.test`, password: "correct-horse-1" })
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "Embed Demo " + stamp })
  const ws = workspace.id
  const project = await call("POST", "/api/w/projects", { name: "Widget site", visibility: "members" }, ws)
  const key = await call("POST", `/api/w/projects/${project.id}/feedback-keys`, { name: "site", allowed_origins: [WEB] }, ws)
  return { ws, slug: workspace.slug, project: project.id, pk: key.public_key }
}, { stamp, WEB })
console.log("• project", setup.project, "key", setup.pk)

// Inject the loader onto this allowed-origin page.
await P.evaluate(({ API, pk }) => new Promise((resolve, reject) => {
  const s = document.createElement("script")
  s.src = `${API}/embed/v1.js`
  s.setAttribute("data-key", pk)
  s.setAttribute("data-endpoint", `${API}/api/feedback/embed`)
  s.onload = () => resolve()
  s.onerror = reject
  document.body.appendChild(s)
}), { API, pk: setup.pk })

// The launcher lives in an open Shadow DOM; Playwright pierces it.
await P.getByRole("button", { name: /Report a problem/i }).click()
await P.getByText("Report a problem").last().waitFor()
await P.getByPlaceholder("What went wrong?").fill("Embedded widget: the header logo is blurry")
const dlg = path.join(SHOTS, "p8-embed-dialog.png")
await P.screenshot({ path: dlg })
await P.getByRole("button", { name: /^Send$/ }).click()
await P.getByText(/your report was sent/i).waitFor({ timeout: 20000 })
assert(true, "the embed widget submitted from an allowed origin")

// Verify the issue landed in the project as source=embed.
const found = await P.evaluate(async ({ ws }) => {
  const r = await fetch("/api/w/issues", { headers: { "X-Workspace-ID": ws } })
  const { issues } = await r.json()
  return (issues ?? []).some((i) => /header logo is blurry/.test(i.title))
}, { ws: setup.ws })
assert(found, "the embedded report created an issue in the project")

console.log(`\nembed dialog screenshot: ${dlg}`)
await ctx.close()
