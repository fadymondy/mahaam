// Task detail screenshots: node e2e/task-detail-shots.mjs  (API + web running; WEB, SHOTS env override)
// Registers a user in-page, builds a workspace/project/task with checklist, subtasks and comments,
// then captures the full page and the side-over in en/ar x light/dark x desktop/mobile.
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3071"
const SHOTS = process.env.SHOTS ?? "C:/tmp/td-shots"
mkdirSync(SHOTS, { recursive: true })
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "td-")), {
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1440, height: 900 },
})
const page = ctx.pages()[0]
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(`${WEB}/en/login`, { waitUntil: "load" })

const email = `td-${Date.now()}@example.test`
const s = await page.evaluate(async ({ email }) => {
  const j = async (res) => { const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
  await j(await fetch("/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ email, password: "correct-horse-1" }) }))
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "Detail " + Date.now().toString(36) })
  const ws = workspace.id
  const me = await j(await fetch("/api/auth/me"))
  const p = await call("POST", "/api/w/projects", { name: "Website relaunch", color: "teal" }, ws)
  const label = await call("POST", "/api/w/labels", { name: "design", color: "pink" }, ws)
  const label2 = await call("POST", "/api/w/labels", { name: "frontend", color: "blue" }, ws)
  const doing = p.statuses[1]
  const t = await call("POST", `/api/w/projects/${p.id}/tasks`, {
    title: "Wireframe the home page", description: "## Goal\nDesign the **home page** wireframes.\n\n- Hero section\n- Pricing table\n- Footer links",
    label_ids: [label.id, label2.id], assignee_ids: [String(me.id)], priority: "high", due_at: "2026-12-30", estimate_minutes: 240, status: doing.id,
  }, ws)
  for (const c of ["Gather references", "Sketch the hero", "Review with the client"]) await call("POST", `/api/w/tasks/${t.key}/checklist`, { title: c }, ws)
  const sub1 = await call("POST", `/api/w/projects/${p.id}/tasks`, { title: "Hero section copy", parent: t.key, assignee_ids: [String(me.id)], due_at: "2026-11-02" }, ws)
  await call("POST", `/api/w/projects/${p.id}/tasks`, { title: "Pricing table layout", parent: t.key }, ws)
  await call("POST", `/api/w/tasks/${t.key}/comments`, { body: "Kicking this off today, first pass by Thursday." }, ws)
  await call("POST", `/api/w/issues/${t.key}/comments`, { body: "Please follow the **brand guide** for the hero." }, ws).catch(() => {})
  await call("POST", `/api/w/time/entries`, { project_id: p.id, task_id: t.id, started_at: new Date(Date.now() - 5400e3).toISOString(), ended_at: new Date(Date.now() - 1800e3).toISOString(), description: "Wireframing" }, ws).catch(() => {})
  return { slug: workspace.slug, project: p.id, key: t.key, sub: sub1.key }
}, { email })
console.log(JSON.stringify(s))

const full = `/w/${s.slug}/projects/${s.project}/issues/${s.key}`
const sheet = `/w/${s.slug}/projects/${s.project}/board?task=${s.key}`
const tabs = (process.env.TABS ?? "details,discussions,subtasks,time,activity").split(",")
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 900 })
  for (const locale of ["en", "ar"]) for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((t) => localStorage.setItem("theme", t), theme)
    for (const [name, route] of [["page", full], ["sheet", sheet]]) {
      await page.goto(`${WEB}/${locale}${route}`, { waitUntil: "load" })
      // The Free plan allows 60 API calls/min; on a rate-limit page wait the window out and retry.
      for (let attempt = 0; ; attempt++) {
        const ok = await page.locator("[data-task-detail]").waitFor({ timeout: 15000 }).then(() => true, () => false)
        if (ok) break
        if (attempt >= 2) throw new Error(`task detail never rendered at ${page.url()}`)
        console.log("  rate limited, waiting 65s")
        await page.waitForTimeout(65000)
        await page.goto(`${WEB}/${locale}${route}`, { waitUntil: "load" })
      }
      await page.waitForTimeout(1200)
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, dir: document.documentElement.dir }))
      console.log(`${width} ${locale}/${theme} ${name} overflow=${m.sw > m.cw + 1 ? "YES " + m.sw + "/" + m.cw : "no"} dir=${m.dir}`)
      if (name === "sheet") console.log("  sheet width", await page.evaluate(() => Math.round(document.querySelector("[data-task-sheet]")?.getBoundingClientRect().width ?? -1)))
      await page.screenshot({ path: path.join(SHOTS, `${name}-details-${locale}-${theme}-${width}.png`), fullPage: name === "page" })
      if (name === "page" && theme === "light") {
        for (const tab of tabs.slice(1)) {
          await page.getByRole("tab", { name: new RegExp(`^${{ discussions: "(Discussions|النقاشات)", subtasks: "(Subtasks|المهام)", time: "(Time|الوقت)", activity: "(Activity|سجل)" }[tab]}`) }).click()
          await page.waitForTimeout(500)
          await page.screenshot({ path: path.join(SHOTS, `page-${tab}-${locale}-${theme}-${width}.png`), fullPage: true })
        }
      }
    }
  }
}
console.log(errors.length ? "PAGE ERRORS " + errors.slice(0, 3).join(" | ") : "no page errors")
await ctx.close()
