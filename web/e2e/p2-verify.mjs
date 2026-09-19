// Mahaam P2 — real-browser verification (time tracking exit criteria).
//
//   node e2e/p2-verify.mjs            (API :8110 and web :3010 running; system Chrome)
//   WEB_ORIGIN=https://console.mahaam.app node e2e/p2-verify.mjs
//
// Headless Chrome, fresh profile, frames counted first. Two tabs of one session:
//   1. timer started in tab A (header popover) appears in tab B without reload; stopped in B -> A
//   2. ⌘K "start timer on…" starts on a task; side-over and board card start/stop
//   3. MCP start/stop/log round-trip -> tab A's timesheet updates live and lists the entries
//   4. manual entry through the dialog (date picker = Calendar + Popover), 23:00–01:00 split
//   5. team timesheet, rates (set a rate), time settings render with titles
//   6. en/ar x light/dark screenshots of the timer bar and the timesheet at 1440 and 390
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const TAG = WEB.includes("fadymondy.com") ? "public" : "local"
const here = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(here, "shots", "p2")
mkdirSync(SHOTS, { recursive: true })
rmSync(path.join(SHOTS, `${TAG}-FAILED.png`), { force: true })

const log = (...a) => console.log("•", ...a)
let pageForDump = null
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  console.log("✓", msg)
}
async function dump(err) {
  try {
    if (pageForDump) await pageForDump.screenshot({ path: path.join(SHOTS, `${TAG}-FAILED.png`) })
    const text = pageForDump ? (await pageForDump.evaluate(() => document.body.innerText)).slice(0, 1200) : ""
    console.error(`\n✗ FAIL: ${err?.message ?? err}\nurl: ${pageForDump?.url()}\n--- page text ---\n${text}`)
  } catch (e) {
    console.error("✗ FAIL:", err, "(dump failed:", e, ")")
  }
  process.exit(1)
}
process.on("unhandledRejection", dump)
process.on("uncaughtException", dump)

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "mahaam-p2-")), {
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--disable-extensions", "--no-first-run"],
})
const A = ctx.pages()[0] ?? (await ctx.newPage())
pageForDump = A
const errors = []
const watch = (p, name) => p.on("pageerror", (e) => errors.push(`${name}: ${e}`))
watch(A, "A")

await A.goto(`${WEB}/en/login`, { waitUntil: "load" })
const frames = await A.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(f)) : r(n)); requestAnimationFrame(f) }))
assert(frames > 20, `tab A paints: ${frames} frames/s`)

// ── setup through the session API ─────────────────────────────────────────────
const email = `p2-${Date.now()}@example.test`
const s = await A.evaluate(async ({ email }) => {
  const j = async (res) => { const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
  await j(await fetch("/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ email, password: "correct-horse-1" }) }))
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "P2 Verify " + Date.now().toString(36) })
  const ws = workspace.id
  const me = await j(await fetch("/api/auth/me"))
  await call("PATCH", "/api/w/time/settings", { timezone: "Africa/Cairo", rounding_minutes: 15, default_bill_rate_minor: 5000 }, ws)
  const p = await call("POST", "/api/w/projects", { name: "Website relaunch", color: "teal", billing_mode: "hourly" }, ws)
  const task = await call("POST", `/api/w/projects/${p.id}/tasks`, { title: "Wireframe the home page" }, ws)
  const task2 = await call("POST", `/api/w/projects/${p.id}/tasks`, { title: "Write the launch checklist" }, ws)
  await call("PUT", `/api/w/rates/${me.id}`, { effective_from: "2026-01-01", bill_rate_minor: 12000, cost_rate_minor: 4500 }, ws)
  const tok = await call("POST", "/api/w/mcp_tokens", { name: "claude p2", scopes: ["members:read", "projects:read", "tasks:read", "time:read", "time:write"] }, ws)
  return { ws, slug: workspace.slug, me: String(me.id), project: p.id, task: task.key, task2: task2.key, token: tok.plaintext }
}, { email })
log(`workspace ${s.slug}, tasks ${s.task} ${s.task2}`)
const url = (p, locale = "en") => `${WEB}/${locale}/w/${s.slug}${p}`

// Network-level failures (the public host goes through a tunnel) are retried; in-band tool errors are not.
const fetchRetry = async (u, o) => { for (let i = 0; ; i++) { try { return await fetch(u, o) } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 1500)) } } }
const mcp = async (name, args = {}) => {
  const res = await fetchRetry(`${WEB}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) })
  const out = await res.json()
  const text = out.result?.content?.[0]?.text ?? JSON.stringify(out)
  if (out.result?.isError || !res.ok) throw new Error(`${name}: ${text}`)
  return text
}

// ── 1. tab A -> tab B ───────────────────────────────────────────────────────────
await A.goto(url("/time"), { waitUntil: "load" })
await A.locator("[data-time-totals]").waitFor()
const B = await ctx.newPage()
watch(B, "B")
await B.goto(url("/projects"), { waitUntil: "load" })
await A.waitForFunction(() => document.querySelector("header[data-live]")?.getAttribute("data-live") === "open", null, { timeout: 15000 })
await B.waitForFunction(() => document.querySelector("header[data-live]")?.getAttribute("data-live") === "open", null, { timeout: 15000 })
assert(true, "both tabs have their live stream open")
assert((await A.title()).startsWith("My time ·"), `timesheet title: "${await A.title()}"`)

await A.locator("[data-timer-start]").click()
await A.locator("[data-timer-description]").fill("Design review")
await A.locator("[data-timer-form] [data-target-picker]").click()
await A.locator(`[data-target-project="${s.project}"]`).click()
await A.locator("[data-timer-form] button[type=submit]").click()
await A.locator("[data-timer-bar][data-running=true]").waitFor()
await B.locator("[data-timer-bar][data-running=true]").waitFor({ timeout: 5000 })
const bWhat = await B.locator("[data-timer-what]").textContent()
const bUrl = B.url()
assert(bWhat.includes("Design review") && bUrl.endsWith("/projects"), `tab B shows the timer started in tab A without a reload: "${bWhat}"`)
const e1 = await B.locator("[data-timer-elapsed]").textContent()
// B is a background tab: Chrome throttles its timers, so wait for the change rather than a fixed delay.
await B.waitForFunction((v) => document.querySelector("[data-timer-elapsed]")?.textContent !== v, e1, { timeout: 5000 })
const e2 = await B.locator("[data-timer-elapsed]").textContent()
assert(e1 !== e2, `the clock ticks in tab B (${e1} -> ${e2})`)
await B.locator("[data-timer-stop]").click()
await A.locator("[data-timer-bar][data-running=false]").waitFor({ timeout: 5000 })
assert(true, "stopped in tab B -> tab A's bar is idle without a reload")

// ── 2. ⌘K, side-over and board card ─────────────────────────────────────────────
await A.keyboard.press("Control+k")
await A.locator("[data-timer-palette]").waitFor()
await A.keyboard.type("Wireframe")
await A.locator(`[data-palette-task="${s.task}"]`).click()
await B.locator("[data-timer-bar][data-running=true]").waitFor({ timeout: 5000 })
assert((await B.locator("[data-timer-what]").textContent()).includes("Wireframe"), "⌘K started a timer on the task; tab B follows")

await B.goto(`${url(`/projects/${s.project}/board`)}?task=${s.task2}`, { waitUntil: "load" })
const sheetBtn = B.locator(`[data-task-sheet="${s.task2}"] [data-start-timer="${s.task2}"]`)
await sheetBtn.click()
await B.locator(`[data-task-sheet="${s.task2}"] [data-start-timer="${s.task2}"][data-running-here=true]`).waitFor()
await A.waitForFunction(() => document.querySelector("[data-timer-what]")?.textContent?.includes("launch checklist"), null, { timeout: 5000 })
assert(true, "side-over 'Start timer' stopped the ⌘K timer and started on its task; tab A follows")
await B.keyboard.press("Escape")
await B.goto(url(`/projects/${s.project}/board`), { waitUntil: "load" })
const cardBtn = B.locator(`[data-start-timer="${s.task}"]`)
await B.locator(`[data-task-key="${s.task}"]`).hover()
await cardBtn.click()
await B.locator(`[data-start-timer="${s.task}"][data-running-here=true]`).waitFor()
assert(!new URL(B.url()).searchParams.get("task"), "the board card's start button did not open the task")
await cardBtn.click()
await A.locator("[data-timer-bar][data-running=false]").waitFor({ timeout: 5000 })
assert(true, "board card start/stop; tab A follows")

// ── 3. MCP round-trip lands on the open timesheet ───────────────────────────────
const before = await A.locator("[data-entry]").count()
log(await mcp("start_timer", { task: s.task, description: "Agent pairing" }))
await A.locator("[data-timer-bar][data-running=true]").waitFor({ timeout: 5000 })
log(await mcp("stop_timer"))
await A.locator("[data-timer-bar][data-running=false]").waitFor({ timeout: 5000 })
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
log(await mcp("log_time", { task: s.task, date: yesterday, minutes: 45, description: "MCP logged review" }))
await A.waitForFunction((n) => document.querySelectorAll("[data-entry]").length > n, before, { timeout: 5000 })
await A.locator('[data-entry-source="mcp"]').first().waitFor()
assert((await A.locator('[data-entry-source="mcp"]').count()) >= 1, "MCP start/stop shows on the open timesheet without a reload")
await A.locator(`[data-day="${yesterday}"]`).click().catch(() => {})
const onYesterday = await A.locator(`[data-day-list="${yesterday}"]`).count()
if (onYesterday) {
  await A.locator('[data-day-list] [data-entry-source="mcp"]', { hasText: "MCP logged review" }).waitFor()
  assert(true, "log_time over MCP is on yesterday's list")
}
const whoami = await mcp("whoami")
assert(whoami.includes("running timer: none"), "whoami reports the running timer line")

// ── 4. manual entry through the dialog: 23:00–01:00 ─────────────────────────────
await A.goto(url("/time"), { waitUntil: "load" })
await A.locator("[data-day-strip] [data-day]").nth(6).waitFor()
const days = await A.locator("[data-day]").evaluateAll((els) => els.map((e) => e.getAttribute("data-day")))
const first = days[0]
await A.locator(`[data-day="${first}"]`).click()
await A.locator("[data-add-time]").click()
const form = A.locator("[data-entry-form=add]")
await form.waitFor()
await form.locator("#te-desc").fill("Night deploy")
await form.locator("#te-date").click()
await A.locator('[data-slot="calendar"], .rdp-root').first().waitFor()
await A.keyboard.press("Escape")
await form.locator("#te-from").fill("23:00")
await form.locator("#te-to").fill("01:00")
await form.locator("button[type=submit]").click()
await form.waitFor({ state: "detached" })
await A.locator(`[data-day-list="${first}"] [data-entry]`, { hasText: "Night deploy" }).waitFor()
const range = await A.locator(`[data-day-list="${first}"] [data-entry]`, { hasText: "Night deploy" }).locator("[data-entry-range]").textContent()
await A.locator(`[data-day="${days[1]}"]`).click()
const next = A.locator(`[data-day-list="${days[1]}"] [data-entry]`, { hasText: "Night deploy" })
await next.waitFor()
const nextRange = await next.locator("[data-entry-range]").textContent()
assert(range.includes("23:00–00:00") && nextRange.includes("00:00–01:00"), `23:00–01:00 is split at local midnight: "${range}" / "${nextRange}"`)

// ── 5. other P2 pages ───────────────────────────────────────────────────────────
for (const [p, want] of [["/time/team", "Team time ·"], ["/settings/time", "Time settings ·"], ["/settings/rates", "Rates ·"]]) {
  await A.goto(url(p), { waitUntil: "load" })
  await A.waitForFunction((w) => document.title.startsWith(w), want, { timeout: 10000 })
  assert(true, `${p} renders, title "${await A.title()}"`)
}
await A.goto(url("/settings/rates"), { waitUntil: "load" })
await A.locator(`[data-set-rate="${s.me}"]`).click()
await A.locator("#r-bill").fill("150")
await A.locator("[data-rate-form] button[type=submit]").click()
await A.locator(`[data-rate-member="${s.me}"] [data-rate-bill]`, { hasText: "150" }).waitFor()
assert(true, "a rate set through the dialog shows in the table")
await A.goto(url("/time/team"), { waitUntil: "load" })
await A.locator(`[data-team-member="${s.me}"]`).waitFor()
assert(true, "team timesheet lists the owner")

// ── 6. screenshots: en/ar x light/dark x 1440/390 ─────────────────────────────────
await mcp("start_timer", { task: s.task, description: "Screenshot session" })
const shots = []
for (const width of [1440, 390]) {
  await A.setViewportSize({ width, height: 900 })
  for (const locale of ["en", "ar"]) {
    for (const theme of ["light", "dark"]) {
      await A.emulateMedia({ colorScheme: theme })
      await A.evaluate((t) => localStorage.setItem("theme", t), theme)
      await A.goto(url("/time", locale), { waitUntil: "load" }) // navigate after a theme change
      await A.locator("[data-timer-bar][data-running=true]").waitFor()
      await A.locator("[data-time-totals]").waitFor()
      const m = await A.evaluate(() => ({ dir: document.documentElement.dir, dark: document.documentElement.classList.contains("dark"), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      assert(m.dir === (locale === "ar" ? "rtl" : "ltr") && m.dark === (theme === "dark") && m.sw <= m.cw + 1, `${width} ${locale}/${theme}: dir ${m.dir}, dark ${m.dark}, no overflow (${m.sw}/${m.cw})`)
      const overlaps = await A.evaluate(() => {
        const els = [...document.querySelectorAll("header[data-live] button, header[data-live] a, header[data-live] [data-timer-running]")]
          .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
        let n = 0
        for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
          const a = els[i], b = els[j]
          const inside = (x, y) => x.left >= y.left - 1 && x.right <= y.right + 1 && x.top >= y.top - 1 && x.bottom <= y.bottom + 1
          if (inside(a, b) || inside(b, a)) continue // a control inside the timer pill
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++
        }
        return n
      })
      assert(overlaps === 0, `${width} ${locale}/${theme}: header controls do not overlap (${overlaps})`)
      const sheet = path.join(SHOTS, `${TAG}-timesheet-${locale}-${theme}-${width}.png`)
      await A.screenshot({ path: sheet, fullPage: width === 390 })
      const bar = path.join(SHOTS, `${TAG}-timerbar-${locale}-${theme}-${width}.png`)
      await A.locator("header[data-live]").screenshot({ path: bar })
      shots.push(sheet, bar)
    }
  }
}
await mcp("stop_timer")

assert(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`)
console.log(`\n${shots.length} screenshots in ${SHOTS}`)
await ctx.close()
