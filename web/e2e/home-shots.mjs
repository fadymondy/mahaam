// Home + shell screenshots: en/ar x light/dark x desktop/mobile.
//   WEB_ORIGIN=http://localhost:3021 OUT=<dir> node e2e/home-shots.mjs
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const WEB = process.env.WEB_ORIGIN ?? "http://localhost:3021"
const OUT = process.env.OUT ?? path.join(tmpdir(), "home-shots")
mkdirSync(OUT, { recursive: true })

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "home-")), {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1440, height: 900 },
})
const page = ctx.pages()[0]
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(`${WEB}/en/login`, { waitUntil: "load" })

// The free plan caps projects at 2; the dashboard needs a few, so seed on Pro (also gives the plan card real data).
await page.exposeFunction("upgrade", (id) => { execSync(`docker exec mahaam-postgres psql -U postgres -d mahaam -c "update workspaces set plan = 'pro' where id = '${id}'"`); return true })
const email = `home-${Date.now()}@example.test`
const s = await page.evaluate(async ({ email }) => {
  const j = async (res) => { const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
  await j(await fetch("/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ email, password: "correct-horse-1" }) }))
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "Studio " + Date.now().toString(36) })
  const ws = workspace.id
  await window.upgrade(ws)
  const me = await j(await fetch("/api/auth/me"))
  const cl = await call("POST", "/api/w/clients", { name: "Acme Trading", email: "ops@acme.test", country: "EG" }, ws)
  const mk = (name, color, extra = {}) => call("POST", "/api/w/projects", { name, color, ...extra }, ws)
  const p1 = await mk("Website relaunch", "teal", { client_id: cl.id })
  const p2 = await mk("Mobile app", "violet")
  const p3 = await mk("Brand identity with a deliberately long project name", "amber", { client_id: cl.id })
  const p4 = await mk("Internal tools", "pink")
  const task = (p, body) => call("POST", `/api/w/projects/${p.id}/tasks`, body, ws)
  const mine = [String(me.id)]
  const t1 = await task(p1, { title: "Wireframe the home page", assignee_ids: mine, priority: "high", due_at: "2020-01-01" })
  await task(p1, { title: "Write the launch checklist", assignee_ids: mine, priority: "urgent" })
  const done = await task(p1, { title: "Pick a hosting plan" })
  await call("PATCH", `/api/w/tasks/${done.key}`, { status: "Done" }, ws)
  await task(p2, { title: "Auth flow", assignee_ids: mine, due_at: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) })
  await task(p2, { title: "Push notifications" })
  await task(p3, { title: "Logo exploration", priority: "high" })
  await call("POST", "/api/w/time/entries", { project: p1.id, task: t1.key, minutes: 150, billable: true, date: new Date().toISOString().slice(0, 10) }, ws)
  await call("POST", "/api/w/time/entries", { project: p2.id, minutes: 90, date: new Date().toISOString().slice(0, 10) }, ws)
  return { slug: workspace.slug }
}, { email })

const cases = []
for (const locale of ["en", "ar"]) for (const theme of ["light", "dark"]) for (const [name, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]]) cases.push({ locale, theme, name, w, h })

for (const c of cases) {
  await page.setViewportSize({ width: c.w, height: c.h })
  await page.emulateMedia({ colorScheme: c.theme })
  await page.addInitScript(() => {})
  await page.goto(`${WEB}/${c.locale}/w/${s.slug}`, { waitUntil: "load", timeout: 180000 })
  await page.evaluate((theme) => { localStorage.setItem("theme", theme); document.documentElement.classList.toggle("dark", theme === "dark") }, c.theme)
  await page.waitForSelector("[data-home] [data-project-card]", { timeout: 60000 })
  await page.waitForTimeout(1500)
  const file = path.join(OUT, `home-${c.locale}-${c.theme}-${c.name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  const info = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  console.log(file, JSON.stringify(info), info.sw > info.cw ? "OVERFLOW" : "")
}
console.log("errors:", errors.length ? errors : "none")
await ctx.close()
