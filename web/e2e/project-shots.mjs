// Project header + overview screenshots: node e2e/project-shots.mjs  (API + web running)
// Seeds a workspace/project through the real session API, then captures the overview, board and
// settings tabs in en/ar x light/dark, desktop and mobile, into e2e/shots/proj-*.png.
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "shots")
mkdirSync(SHOTS, { recursive: true })

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "mahaam-proj-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--disable-extensions", "--no-first-run"],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.setDefaultNavigationTimeout(150000)
const errors = []
page.on("console", (m) => m.type() === "error" && !/favicon|DevTools|Download the React/i.test(m.text()) && errors.push(m.text()))
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
const email = `shots-${Date.now()}@example.test`
const setup = await page.evaluate(async ({ email }) => {
  const j = async (res) => {
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${res.url} ${text}`)
    return text ? JSON.parse(text) : {}
  }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  await j(await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token }, body: JSON.stringify({ email, password: "correct-horse-1" }) }))
  const call = (method, url, body, ws) => fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "Shots " + Date.now().toString(36) })
  const ws = workspace.id
  const client = await call("POST", "/api/w/clients", { name: "Acme Trading", email: "ops@acme.test", country: "EG" }, ws)
  const project = await call("POST", "/api/w/projects", { name: "Website relaunch", description: "Rebuild the marketing site: new brand, faster pages, Arabic first.", client_id: client.id, color: "teal", budget_minutes: 1200, billing_mode: "hourly", ends_on: "2026-12-31" }, ws)
  const [, doing, review, done] = project.statuses
  const mk = (title, extra = {}) => call("POST", `/api/w/projects/${project.id}/tasks`, { title, ...extra }, ws)
  await mk("Wireframe the home page", { priority: "high", due_at: "2026-09-20" })
  await mk("Write the launch checklist", { priority: "medium", due_at: "2026-09-25" })
  await mk("Pick a hosting plan", { status: doing.id })
  await mk("Draft the brand voice", { status: review.id, priority: "low" })
  await mk("Kick-off call", { status: done.id })
  await mk("Collect assets", { status: done.id })
  await call("POST", "/api/w/issues", { title: "Header overlaps on mobile", issue_type: "bug", priority: "high", project: project.id }, ws)
  await call("POST", "/api/w/issues", { title: "Add Arabic font", issue_type: "feature", project: project.id }, ws)
  await call("POST", "/api/w/time/entries", { project: project.id, minutes: 600, date: new Date().toISOString().slice(0, 10), description: "Design" }, ws).catch((e) => console.log("time:", e.message))
  return { slug: workspace.slug, id: project.id }
}, { email })
console.log("seeded", setup)

const url = (locale, tab = "") => `${WEB}/${locale}/w/${setup.slug}/projects/${setup.id}${tab}`
async function shot(name, locale, theme, size, tab) {
  await page.waitForTimeout(Number(process.env.SHOT_GAP ?? 0))
  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: theme })
  await page.evaluate((t) => localStorage.setItem("theme", t), theme)
  await page.goto(url(locale, tab), { waitUntil: "load" })
  await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 2500))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) console.log(`! horizontal overflow ${overflow}px in ${name}`)
  const f = path.join(SHOTS, `proj-${name}.png`)
  await page.screenshot({ path: f, fullPage: true })
  console.log("shot", f)
}
const D = { width: 1440, height: 900 }
const M = { width: 390, height: 844 }
for (const locale of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    await shot(`overview-${locale}-${theme}-desktop`, locale, theme, D, "")
    await shot(`overview-${locale}-${theme}-mobile`, locale, theme, M, "")
  }
}
await shot("board-en-light-desktop", "en", "light", D, "/board")
await shot("settings-ar-dark-desktop", "ar", "dark", D, "/settings")
await shot("board-ar-light-mobile", "ar", "light", M, "/board")
console.log("console errors:", errors.length ? errors.slice(0, 8).join("\n") : "(none)")
await ctx.close()
