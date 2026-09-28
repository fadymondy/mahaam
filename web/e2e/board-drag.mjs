// Board drag and drop on the fm issues view: a card into another column, then within a column.
import { chromium } from "playwright-core"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const WEB = process.env.WEB ?? "http://localhost:3010"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "drag-")), { executablePath: CHROME, headless: true, viewport: { width: 1400, height: 900 } })
const page = ctx.pages()[0]
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()))
page.on("response", (r) => r.url().includes("/move") && console.log("[move]", r.status(), r.request().postData()))
await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
const s = await page.evaluate(async () => {
  const j = async (res) => { const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  await j(await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token }, body: JSON.stringify({ email: `d-${Date.now()}@example.test`, password: "correct-horse-1" }) }))
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "Drag " + Date.now().toString(36) })
  const ws = workspace.id
  const project = await call("POST", "/api/w/projects", { name: "Drag" }, ws)
  const keys = []
  for (const t of ["One", "Two", "Three"]) keys.push((await call("POST", `/api/w/projects/${project.id}/tasks`, { title: t }, ws)).key)
  return { slug: workspace.slug, pid: project.id, keys }
})
await page.goto(`${WEB}/ar/w/${s.slug}/projects/${s.pid}/board`, { waitUntil: "load" })
const card = (k) => page.locator(`[data-task-key="${k}"]`)
await card(s.keys[0]).waitFor()
const sections = page.locator("section")
console.log("columns", await sections.count(), "draggable", await page.locator("article[draggable=true]").count())
const drag = async (fromLoc, toLoc, dy = 10) => {
  const a = await fromLoc.boundingBox(), b = await toLoc.boundingBox()
  await page.evaluate(() => { window.__last = null; document.addEventListener("dragover", (e) => { window.__last = e.clientY + " " + (e.target.closest("article")?.innerText.slice(0, 5)) }, true) })
  await page.mouse.move(a.x + a.width / 2, a.y + 10)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) { await page.mouse.move(a.x + a.width / 2 + (b.x + b.width / 2 - a.x - a.width / 2) * i / 20, a.y + 10 + (b.y + dy - a.y - 10) * i / 20); await page.waitForTimeout(16) }
  await page.mouse.move(b.x + b.width / 2, b.y + dy + 1)
  await page.waitForTimeout(200)
  console.log("last dragover", await page.evaluate(() => window.__last), "target top", b.y)
  await page.mouse.up()
  await page.waitForTimeout(1500)
}
await drag(card(s.keys[0]), sections.nth(1).locator("h2"), 40)
await page.reload({ waitUntil: "load" }); await card(s.keys[0]).waitFor()
console.log("col1 after:", await sections.nth(1).innerText().then((t) => t.slice(0, 80).replace(/\n/g, " | ")))
console.log("col0 before:", (await sections.nth(0).locator("article").allInnerTexts()).map((t) => t.slice(0, 6)))
const b2 = await card(s.keys[1]).boundingBox(); console.log("two box", JSON.stringify(b2)); await drag(card(s.keys[2]), card(s.keys[1]), 5)
await page.reload({ waitUntil: "load" }); await card(s.keys[1]).waitFor()
console.log("col0 order:", (await sections.nth(0).locator("article").allInnerTexts()).map((t) => t.split("\n")[0]))
await drag(card(s.keys[1]), card(s.keys[2]), 5)
await page.reload({ waitUntil: "load" }); await card(s.keys[1]).waitFor()
console.log("col0 after reorder (want Two, Three):", (await sections.nth(0).locator("article").allInnerTexts()).map((t) => t.split(/\s/)[0]))
await drag(card(s.keys[1]), card(s.keys[2]), 90)
await page.reload({ waitUntil: "load" }); await card(s.keys[1]).waitFor()
console.log("col0 after move down (want Three, Two):", (await sections.nth(0).locator("article").allInnerTexts()).map((t) => t.split(/\s/)[0]))
await page.screenshot({ path: "e2e/shots/board-drag.png" })
await ctx.close()
