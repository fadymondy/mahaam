// "My time" page: seed a workspace with ~6 weeks of time (people + agent entries), then screenshot the
// overview in en/ar x light/dark at desktop and mobile, plus the other tabs, and check for overflow.
//
//   node e2e/time-shots.mjs     (API and web running; WEB_ORIGIN defaults to http://127.0.0.1:3010)
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const here = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(here, "shots", "time")
mkdirSync(SHOTS, { recursive: true })

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "mahaam-time-")), {
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--disable-extensions", "--no-first-run"],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(`${WEB}/en/login`, { waitUntil: "load" })

const email = `time-${Date.now()}@example.test`
const s = await page.evaluate(async ({ email }) => {
  const j = async (res) => { const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
  await j(await fetch("/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ email, password: "correct-horse-1" }) }))
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "Time Shots " + Date.now().toString(36) })
  const ws = workspace.id
  await call("PATCH", "/api/w/time/settings", { timezone: "Africa/Cairo", rounding_minutes: 15, default_bill_rate_minor: 5000 }, ws)
  const projects = []
  for (const [name, color, mode] of [["Website relaunch", "violet", "hourly"], ["Internal tooling", "orange", "non_billable"]]) {
    const p = await call("POST", "/api/w/projects", { name, color, billing_mode: mode }, ws)
    const tasks = []
    for (const title of [`${name}: plan`, `${name}: build`, `${name}: review`]) tasks.push(await call("POST", `/api/w/projects/${p.id}/tasks`, { title }, ws))
    projects.push({ id: p.id, tasks: tasks.map((t) => ({ id: t.id, key: t.key })) })
  }
  const tok = await call("POST", "/api/w/mcp_tokens", { name: "agent", scopes: ["members:read", "projects:read", "tasks:read", "time:read", "time:write"] }, ws)
  // ~6 weeks of weekdays ending yesterday (Cairo is UTC+3 until late October), sequential slots.
  let seed = 7
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const today = new Date()
  let made = 0
  for (let back = 1; back <= 42; back++) {
    const d = new Date(today.getTime() - back * 86400000)
    const dow = d.getUTCDay()
    if (dow === 5 || dow === 6) continue
    const day = d.toISOString().slice(0, 10)
    let at = 9 * 60 + rnd(40)
    for (let k = 0, n = 2 + rnd(3); k < n; k++) {
      const len = 30 + rnd(14) * 10
      const p = projects[rnd(projects.length)]
      const task = p.tasks[rnd(3)]
      const from = new Date(`${day}T00:00:00Z`).getTime() + (at - 180) * 60000
      const body = { started_at: new Date(from).toISOString(), ended_at: new Date(from + len * 60000).toISOString(), description: ["Planning", "Implementation", "Code review", "Sync", "Bug fixing"][rnd(5)], ...(rnd(5) === 0 ? {} : { task: task.id }) }
      await call("POST", "/api/w/time/entries", body, ws).catch(() => null)
      made++
      at += len + 10 + rnd(50)
    }
  }
  const me = await j(await fetch("/api/auth/me"))
  return { ws, slug: workspace.slug, me: String(me.id), token: tok.plaintext, projects, made }
}, { email })
console.log(`workspace ${s.slug}: ${s.made} entries`)

// Agent entries (source mcp) on a few recent days, overlapping the people's hours.
const mcp = async (name, args) => {
  const res = await fetch(`${WEB}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) })
  return (await res.json()).result?.content?.[0]?.text
}
for (let back = 1; back <= 12; back++) {
  const d = new Date(Date.now() - back * 86400000)
  if ([5, 6].includes(d.getUTCDay())) continue
  const date = d.toISOString().slice(0, 10)
  await mcp("log_time", { task: s.projects[back % 2].tasks[0].key, date, started_at: "10:00", ended_at: `${11 + (back % 3)}:30`, description: "Agent: refactor" })
}

// The Free plan allows 60 API calls a minute per workspace; the seed spends it all, and every page
// load costs ~10, so let the window reset and pace the shots.
await page.waitForTimeout(65000)
const m = async (locale, theme, width, tab = "", extra = "") => {
  await page.waitForTimeout(9000)
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: theme })
  await page.evaluate((t) => localStorage.setItem("theme", t), theme)
  await page.goto(`${WEB}/${locale}/w/${s.slug}/time?${tab ? `tab=${tab}&` : ""}ref=${REF}&${extra}`, { waitUntil: "load" })
  await page.locator("[data-time-tabs]").waitFor()
  await page.waitForFunction(() => document.querySelector("[data-time-overview],[data-time-log],[data-time-weeks],[data-time-reports]"), null, { timeout: 20000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(SHOTS, "FAILED.png"), fullPage: true })
    console.error((await page.evaluate(() => document.body.innerText)).slice(0, 800))
    throw e
  })
  await page.waitForTimeout(700)
  const info = await page.evaluate(() => ({ dir: document.documentElement.dir, dark: document.documentElement.classList.contains("dark"), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  const file = path.join(SHOTS, `${tab || "overview"}${extra ? "-" + extra.replace(/[^a-z0-9]/gi, "") : ""}-${locale}-${theme}-${width}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`${path.basename(file)} dir=${info.dir} dark=${info.dark} overflow=${info.sw - info.cw}`)
}
const only = process.env.ONLY
// A few days back, so the week on screen (and the one before it) has data whichever weekday it is.
var REF = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
for (const locale of ["en", "ar"]) for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
  if (only && only !== `${locale}-${theme}-${width}`) continue
  await m(locale, theme, width)
}
if (!only) {
  for (const tab of ["log", "week", "reports"]) for (const [locale, theme, width] of [["en", "light", 1440], ["ar", "dark", 390]]) await m(locale, theme, width, tab)
  await m("en", "light", 1440, "", "range=month")
  await m("ar", "dark", 1440, "", "range=month")
  await m("en", "light", 1440, "", "source=agent")
}
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors")
await ctx.close()
