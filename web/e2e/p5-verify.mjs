// Mahaam P5 — real-browser verification (reports, budgets, profitability, saved views, notification settings).
//
//   node e2e/p5-verify.mjs            (API :8110 and web :3010 running; system Chrome)
//   WEB_ORIGIN=https://console.mahaam.app node e2e/p5-verify.mjs
//   QUICK=1 node e2e/p5-verify.mjs    (screenshots at 1440 en/light only)
//
// Headless Chrome, fresh profile, frames counted first; waits for `load` (the live stream keeps a
// request open). A throwaway owner + workspace is registered through the API, with a client, two
// projects (one with a 60-minute budget), labels, tasks, a member rate and manual entries including a
// 23:00–01:00 one. Then, in the browser:
//   1. the report's total equals the API's; CSV and XLSX downloaded from the buttons; CSV == table cell for cell
//   2. grouping by label shows the note; by day lists every day of the range
//   3. saved views: save (shared), open, rename, delete
//   4. budgets tab (level over), profitability tables (+ CSV == table), project budget panel (+ "no budget")
//   5. notification settings: "email not configured" notice, mute/unmute a kind; the bell renders budget.threshold
//   6. print media hides the chrome and shows the print header
//   7. screenshots of every P5 page at 1440 and 390, en/ar × light/dark -> e2e/shots/p5-*.png
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const TAG = WEB.includes("fadymondy.com") ? "public" : "local"
const QUICK = !!process.env.QUICK
const here = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(here, "shots")
mkdirSync(SHOTS, { recursive: true })
const FAILED = path.join(SHOTS, `p5-${TAG}-FAILED.png`)
rmSync(FAILED, { force: true })

const log = (...a) => console.log("•", ...a)
let page = null
let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  passed++
  console.log("✓", msg)
}
async function dump(err) {
  try {
    if (page) await page.screenshot({ path: FAILED, fullPage: true })
    const text = page ? (await page.evaluate(() => document.body.innerText)).slice(0, 1500) : ""
    console.error(`\n✗ FAIL: ${err?.stack ?? err}\nurl: ${page?.url()}\n--- page text ---\n${text}`)
  } catch (e) {
    console.error("✗ FAIL:", err, "(dump failed:", e, ")")
  }
  process.exit(1)
}
process.on("unhandledRejection", dump)
process.on("uncaughtException", dump)

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "mahaam-p5-")), {
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  args: ["--disable-extensions", "--no-first-run"],
})
page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
const frames = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(f)) : r(n)); requestAnimationFrame(f) }))
assert(frames > 20, `the page paints: ${frames} frames/s`)

// ── setup through the session API ─────────────────────────────────────────────
const email = `p5-${Date.now()}@example.test`
const s = await page.evaluate(async ({ email }) => {
  const j = async (res) => { const t = await res.text(); if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`); return t ? JSON.parse(t) : {} }
  const { csrf_token } = await j(await fetch("/api/auth/csrf"))
  const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
  await j(await fetch("/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ email, password: "correct-horse-1" }) }))
  const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
  const { workspace } = await call("POST", "/api/me/workspaces", { name: "P5 Verify " + Date.now().toString(36) })
  const ws = workspace.id
  const me = await j(await fetch("/api/auth/me"))
  const meId = String(me.id)
  await call("PATCH", "/api/w/time/settings", { timezone: "Africa/Cairo", rounding_minutes: 15 }, ws)
  // Rates first: entries snapshot the rate when they are created.
  await call("PUT", `/api/w/rates/${meId}`, { effective_from: "2026-01-01", bill_rate_minor: 12000, cost_rate_minor: 4500 }, ws)
  const client = await call("POST", "/api/w/clients", { name: "Acme Trading", email: "ops@acme.test", country: "EG" }, ws)
  const pa = await call("POST", "/api/w/projects", { name: "Website relaunch", color: "teal", billing_mode: "hourly", client_id: client.id, budget_minutes: 60, budget_minor: 20000, currency: "USD" }, ws)
  const pb = await call("POST", "/api/w/projects", { name: "Internal tooling", color: "violet", billing_mode: "non_billable" }, ws)
  const design = await call("POST", "/api/w/labels", { name: "design", color: "pink" }, ws)
  const urgent = await call("POST", "/api/w/labels", { name: "urgent", color: "red" }, ws)
  const t1 = await call("POST", `/api/w/projects/${pa.id}/tasks`, { title: "Wireframe the home page", label_ids: [design.id, urgent.id] }, ws)
  const t2 = await call("POST", `/api/w/projects/${pb.id}/tasks`, { title: "Set up CI", label_ids: [design.id] }, ws)
  // Today and yesterday in the workspace timezone.
  const day = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms))
  const today = day(Date.now())
  const yesterday = day(Date.now() - 86400000)
  const log = (b) => call("POST", "/api/w/time/entries", b, ws)
  await log({ project: pa.id, task: t1.key, date: today, minutes: 50, description: "Wireframes", billable: true })
  await log({ project: pa.id, date: today, started_at: "08:00", ended_at: "08:37", description: "Kick-off call", billable: true })
  await log({ project: pb.id, task: t2.key, date: today, minutes: 45, description: "Pipeline", billable: false })
  await log({ project: pb.id, date: yesterday, started_at: "23:00", ended_at: "01:00", description: "Night deploy", billable: false })
  await log({ date: today, minutes: 20, description: "Inbox", billable: false })
  return { ws, slug: workspace.slug, me: meId, pa: pa.id, pb: pb.id, client: client.id, today, yesterday }
}, { email })
log(`workspace ${s.slug}; today ${s.today} (Africa/Cairo)`)
const url = (p, locale = "en") => `${WEB}/${locale}/w/${s.slug}${p}`
const apiGet = (p) => page.evaluate(async ({ p, ws }) => { const r = await fetch(p, { headers: { "X-Workspace-ID": ws } }); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.json() }, { p, ws: s.ws })

// ── helpers ─────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "")
  const rows = []
  let row = [], cell = "", q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ",") { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = "" }
    else cell += c
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.length > 1 || r[0] !== "")
}
const tableRows = (sel) =>
  page.evaluate((sel) => {
    const out = []
    for (const tr of document.querySelectorAll(`${sel} tbody tr, ${sel} tfoot tr`)) {
      const k = tr.getAttribute("data-row")
      const name = k === "total" ? "TOTAL" : k === "none" ? "NONE" : tr.querySelector("[data-cell-name]")?.textContent?.trim()
      const cells = [...tr.querySelectorAll("[data-cell]")].map((c) => c.textContent.trim().replace(/^—$/, ""))
      out.push([name, ...cells])
    }
    return { heads: document.querySelectorAll(`${sel} thead th`).length, rows: out }
  }, sel)
const csvNorm = (rows) => rows.slice(1).map((r) => [r[0] === "Total" || r[0] === "الإجمالي" ? "TOTAL" : r[0] === "(none)" || r[0] === "(بلا)" ? "NONE" : r[0], ...r.slice(1)])
async function download(selector) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.locator(selector).click()])
  const file = await dl.path()
  return { name: dl.suggestedFilename(), data: readFileSync(file) }
}
const settle = () => page.waitForFunction(() => !document.querySelector("[data-report-body].opacity-70, [data-profit-body].opacity-70"), null, { timeout: 15000 })

// ── 1. time report: table == API == CSV; XLSX is a workbook ────────────────────
await page.goto(url("/reports"), { waitUntil: "load" })
await page.locator("[data-report-table] tfoot [data-row=total]").waitFor({ timeout: 20000 })
assert((await page.title()).startsWith("Reports ·"), `reports title: "${await page.title()}"`)
const range = await page.locator("[data-report-body]").evaluate((e) => ({ from: e.dataset.from, to: e.dataset.to }))
assert(range.from <= s.yesterday || range.from === s.today.slice(0, 8) + "01", `default range is this month: ${range.from} – ${range.to}`)
const api = await apiGet(`/api/w/report/time?from=${range.from}&to=${range.to}&group_by=project`)
const table = await tableRows("[data-report-table]")
const total = table.rows.find((r) => r[0] === "TOTAL")
const hm = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`
const money = (m) => `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 100)}.${String(Math.abs(m) % 100).padStart(2, "0")}`
assert(api.finance === true && table.heads === 9, `owner sees the money columns (${table.heads} columns)`)
assert(total[1] === hm(api.total.seconds) && total[2] === hm(api.total.rounded_s) && total[5] === String(api.total.entries) && total[6] === money(api.total.billable_minor),
  `table total == API total: tracked ${total[1]}, rounded ${total[2]}, entries ${total[5]}, billable ${total[6]}`)
assert(api.total.entries === 5 && api.total.seconds === (50 + 37 + 45 + 120 + 20) * 60, `API counts the 5 entries, ${hm(api.total.seconds)} tracked (cross-midnight entry split inside the range)`)
assert(table.rows.some((r) => r[0] === "NONE"), "an entry without a project shows as the localised “No project” row")
const summary = await page.locator('[data-stat="tracked"]').textContent()
assert(summary.includes(hm(api.total.seconds)), `summary strip shows ${summary}`)
assert((await page.locator("[data-series-chart] .recharts-bar-rectangle").count()) > 0, "the per-day stacked chart has bars")
assert((await page.locator("[data-breakdown-chart] .recharts-bar-rectangle").count()) >= 2, "the breakdown chart has a bar per project")

const csv = await download('[data-report-toolbar] [data-export="csv"]')
const csvRows = parseCsv(csv.data.toString("utf8"))
log(`CSV ${csv.name}: ${csvRows.length} lines — ${csvRows[0].join(" | ")}`)
assert(csv.name.endsWith(".csv") && csvRows[0].length === table.heads, `CSV has the table's ${table.heads} columns`)
assert(JSON.stringify(csvNorm(csvRows)) === JSON.stringify(table.rows), `CSV == table, cell for cell (${table.rows.length} rows incl. total)`)
const xlsx = await download('[data-report-toolbar] [data-export="xlsx"]')
const zipText = xlsx.data.toString("latin1")
assert(xlsx.name.endsWith(".xlsx") && xlsx.data[0] === 0x50 && xlsx.data[1] === 0x4b && zipText.includes("xl/worksheets/sheet") && zipText.includes("[Content_Types].xml"),
  `XLSX ${xlsx.name} is a zip workbook with a worksheet (${xlsx.data.length} bytes)`)

// ── 2. other groupings ─────────────────────────────────────────────────────────
await page.goto(`${url("/reports")}?from=${range.from}&to=${range.to}&group_by=label`, { waitUntil: "load" })
await page.locator("[data-report-body][data-group=label]").waitFor({ timeout: 15000 })
assert(await page.locator('[data-note="label"]').isVisible(), "label grouping shows the “rows can add up to more” note")
const labelRows = await tableRows("[data-report-table]")
assert(labelRows.rows.some((r) => r[0] === "design") && labelRows.rows.some((r) => r[0] === "urgent") && labelRows.rows.some((r) => r[0] === "NONE"), `label rows: ${labelRows.rows.map((r) => r[0]).join(", ")}`)
await page.goto(`${url("/reports")}?from=${range.from}&to=${range.to}&group_by=day`, { waitUntil: "load" })
await page.locator("[data-report-body][data-group=day]").waitFor({ timeout: 15000 })
const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
assert((await page.locator("[data-report-table] tbody tr").count()) === days, `day grouping lists all ${days} days (empty ones included)`)
const dayRows = (await tableRows("[data-report-table]")).rows
const yRow = dayRows.find((r) => r[0] === s.yesterday)
const tRow = dayRows.find((r) => r[0] === s.today)
if (s.yesterday >= range.from) assert(yRow && yRow[1] === "1:00", `23:00–01:00: an hour on ${s.yesterday} (${yRow?.[1]})`)
assert(tRow && tRow[1] === hm((50 + 37 + 45 + 60 + 20) * 60), `…and its second hour on ${s.today} (${tRow?.[1]})`)
// Group-by through the UI control
await page.locator("#rf-group").click()
await page.locator('[data-group-option="client"]').click()
await page.locator("[data-report-body][data-group=client]").waitFor({ timeout: 15000 })
assert(new URL(page.url()).searchParams.get("group_by") === "client", "the group-by control updates the URL and the table")

// ── 3. saved views ───────────────────────────────────────────────────────────────
await page.locator("[data-saved-views]").click()
await page.locator("[data-save-view]").click()
await page.locator("#sv-name").fill("Client hours")
await page.locator("[data-view-shared]").click()
await page.locator("[data-view-form] button[type=submit]").click()
await page.locator("[data-view-form]").waitFor({ state: "detached" })
let views = (await apiGet("/api/w/saved-reports")).reports
const v = views.find((x) => x.name === "Client hours")
assert(v && v.shared && v.kind === "time" && v.filters.group_by === "client" && v.filters.from === range.from, `saved view stored: ${JSON.stringify(v?.filters)} shared=${v?.shared}`)
await page.goto(url("/reports"), { waitUntil: "load" })
await page.locator("[data-saved-views]").click()
await page.locator(`[data-open-view="${v.id}"]`).click()
await page.locator("[data-report-body][data-group=client]").waitFor({ timeout: 15000 })
assert(true, "opening the saved view restores its grouping")
await page.locator("[data-saved-views]").click()
await page.locator(`[data-rename-view="${v.id}"]`).click()
await page.locator("#sv-name").fill("Client hours (monthly)")
await page.locator("[data-view-form] button[type=submit]").click()
await page.locator("[data-view-form]").waitFor({ state: "detached" })
views = (await apiGet("/api/w/saved-reports")).reports
assert(views.find((x) => x.id === v.id)?.name === "Client hours (monthly)", "renamed")
await page.locator("[data-saved-views]").click()
await page.locator(`[data-saved-view="${v.id}"][data-saved-name="Client hours (monthly)"]`).waitFor()
await page.locator(`[data-delete-view="${v.id}"]`).click()
await page.locator("[data-confirm-delete-view]").click()
await page.waitForFunction(async ({ id, ws }) => { const r = await fetch("/api/w/saved-reports", { headers: { "X-Workspace-ID": ws } }); return !(await r.json()).reports.some((x) => x.id === id) }, { id: v.id, ws: s.ws }, { timeout: 10000 })
assert(true, "deleted")
await page.keyboard.press("Escape")

// ── 4. budgets, profitability, project panel ──────────────────────────────────────
await page.goto(url("/reports/budgets"), { waitUntil: "load" })
await page.locator(`[data-budget="${s.pa}"]`).waitFor({ timeout: 15000 })
const lvl = await page.locator(`[data-budget="${s.pa}"]`).getAttribute("data-level")
const pct = await page.locator(`[data-budget="${s.pa}"] [data-meter=hours]`).getAttribute("data-percent")
const bApi = (await apiGet("/api/w/report/budgets")).budgets.find((b) => b.project_id === s.pa)
assert(lvl === bApi.level && lvl === "over" && Math.abs(Number(pct) - bApi.hours_percent) < 0.1, `budget row: level ${lvl}, hours ${pct}% (API ${bApi.hours_percent.toFixed(1)}%)`)
assert((await page.locator(`[data-budget="${s.pa}"] [data-meter=money]`).count()) === 1, "owner sees the money meter")
assert((await page.locator(`[data-budget="${s.pb}"]`).count()) === 0, "a project without a budget is not on the burn list")
assert((await page.title()).startsWith("Budgets ·"), `budgets title "${await page.title()}"`)

await page.goto(`${url("/reports/profitability")}?from=${range.from}&to=${range.to}`, { waitUntil: "load" })
await page.locator('[data-profit-table="project"] tfoot [data-row=total]').waitFor({ timeout: 15000 })
const prof = await apiGet(`/api/w/report/profitability?from=${range.from}&to=${range.to}`)
const pt = await tableRows('[data-profit-table="project"]')
const ptTotal = pt.rows.find((r) => r[0] === "TOTAL")
assert(ptTotal[3] === money(prof.total.billable_minor) && ptTotal[5] === money(prof.total.profit_minor), `profitability total == API: value ${ptTotal[3]}, profit ${ptTotal[5]}`)
assert((await page.locator('[data-profit-table="client"] tbody tr').count()) === prof.clients.length, `client table has ${prof.clients.length} rows`)
const pcsv = await download('[data-export="csv"][data-export-id="project"]')
assert(JSON.stringify(csvNorm(parseCsv(pcsv.data.toString("utf8")))) === JSON.stringify(pt.rows), `profitability CSV (${pcsv.name}) == table, cell for cell`)
const ccsv = await download('[data-export="csv"][data-export-id="client"]')
assert(JSON.stringify(csvNorm(parseCsv(ccsv.data.toString("utf8")))) === JSON.stringify((await tableRows('[data-profit-table="client"]')).rows), `client CSV (${ccsv.name}) == table`)
assert((await page.locator('[data-report-tab="profitability"]').count()) === 1, "owner sees the Profitability tab")

await page.goto(url(`/projects/${s.pa}`), { waitUntil: "load" })
await page.locator("[data-budget-panel][data-level=over]").waitFor({ timeout: 15000 })
assert((await page.locator("[data-budget-panel] [data-meter]").count()) === 2, "project overview: hours + money meters, level over")
await page.goto(url(`/projects/${s.pb}`), { waitUntil: "load" })
await page.locator("[data-budget-panel] [data-budget-none]").waitFor({ timeout: 15000 })
const href = await page.locator("[data-budget-settings]").getAttribute("href")
assert(href?.endsWith(`/projects/${s.pb}/settings`), `no budget: the panel says so and links to ${href}`)

// ── 5. notification settings + bell ────────────────────────────────────────────────
await page.goto(url("/settings/notifications"), { waitUntil: "load" })
await page.locator("[data-notification-settings]").waitFor({ timeout: 15000 })
const nset = await apiGet("/api/w/notification-settings")
if (!nset.email.configured) {
  assert(await page.locator("[data-email-not-configured]").isVisible(), `email not configured (driver ${nset.email.driver}): the notice is shown`)
  assert((await page.locator("[data-email-enabled], [data-digest-enabled]").count()) === 0, "…and no email/digest switches are rendered")
} else {
  assert((await page.locator("[data-email-enabled]").count()) === 1, "email configured: the switches are rendered")
}
assert((await page.locator("[data-kind]").count()) === nset.kinds.length, `${nset.kinds.length} kinds listed`)
await page.locator('[data-kind="task.done"] [role=checkbox], [data-kind="task.done"] button').first().click()
await page.locator('[data-kind="task.done"][data-muted=true]').waitFor({ timeout: 10000 })
assert((await apiGet("/api/w/notification-settings")).muted_kinds.includes("task.done"), "muting task.done is saved")
await page.reload({ waitUntil: "load" })
await page.locator('[data-kind="task.done"][data-muted=true]').waitFor({ timeout: 10000 })
await page.locator('[data-kind="task.done"] [role=checkbox], [data-kind="task.done"] button').first().click()
await page.locator('[data-kind="task.done"][data-muted=false]').waitFor({ timeout: 10000 })
assert(!(await apiGet("/api/w/notification-settings")).muted_kinds.includes("task.done"), "…survives a reload, and un-muting is saved")
assert((await page.title()).startsWith("Notifications ·"), `notification settings title "${await page.title()}"`)

const inbox = await apiGet("/api/w/notifications?limit=30")
const bn = inbox.notifications.find((n) => n.kind === "budget.threshold")
if (bn) {
  await page.locator("[data-notification-bell]").click()
  const item = page.locator('[data-inbox] [data-notification="budget.threshold"]').first()
  await item.waitFor()
  const text = await item.textContent()
  assert(text.includes("Website relaunch") && !/\{[a-z_]+\}/.test(text), `bell renders budget.threshold: "${text.slice(0, 90)}"`)
  await page.keyboard.press("Escape")
} else log("no budget.threshold notification in the inbox (the alert runs on the server's schedule) — bell check skipped")

// ── 6. print media ──────────────────────────────────────────────────────────────────
await page.goto(`${url("/reports")}?from=${range.from}&to=${range.to}`, { waitUntil: "load" })
await page.locator("[data-report-table]").waitFor({ timeout: 15000 })
await page.emulateMedia({ media: "print" })
const pm = await page.evaluate(() => {
  const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0 }
  const td = document.querySelector("[data-report-table] tbody td")
  return { nav: vis(".grid-shell-nav"), header: vis("header[data-live]"), filters: vis("[data-filter-bar]"), toolbar: vis("[data-report-toolbar]"), printHeader: vis("[data-print-header]"), table: vis("[data-report-table]"),
    color: td ? getComputedStyle(td).color : "", bg: getComputedStyle(document.body).backgroundColor, text: document.querySelector("[data-print-header]")?.textContent ?? "" }
})
assert(!pm.nav && !pm.header && !pm.filters && !pm.toolbar && pm.printHeader && pm.table, `print: chrome hidden, header + table shown ("${pm.text.slice(0, 80)}")`)
assert(pm.color === "rgb(0, 0, 0)" && pm.bg === "rgb(255, 255, 255)", `print is black on white (${pm.color} on ${pm.bg})`)
await page.pdf?.({ path: path.join(SHOTS, `p5-${TAG}-print.pdf`), format: "A4" }).catch(() => {})
await page.emulateMedia({ media: "screen" })

// ── 7. screenshots ────────────────────────────────────────────────────────────────────
const q = `?from=${range.from}&to=${range.to}`
const pages = [
  ["reports", `/reports${q}`, "[data-report-table]"],
  ["budgets", "/reports/budgets", "[data-budget-table]"],
  ["profitability", `/reports/profitability${q}`, '[data-profit-table="client"]'],
  ["project-budget", `/projects/${s.pa}`, "[data-budget-panel] [data-meter]"],
  ["notifications", "/settings/notifications", "[data-notification-settings]"],
]
const shots = []
for (const width of [1440, 390]) {
  if (QUICK && width !== 1440) continue
  await page.setViewportSize({ width, height: 900 })
  for (const locale of QUICK ? ["en"] : ["en", "ar"]) {
    for (const theme of QUICK ? ["light"] : ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate((t) => localStorage.setItem("theme", t), theme)
      for (const [name, p, ready] of pages) {
        await page.goto(url(p, locale), { waitUntil: "load" }) // navigate after a theme change, then measure
        await page.locator(ready).first().waitFor({ timeout: 20000 })
        await page.waitForTimeout(500)
        const m = await page.evaluate(() => ({ dir: document.documentElement.dir, dark: document.documentElement.classList.contains("dark"), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, main: Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0) }))
        assert(m.dir === (locale === "ar" ? "rtl" : "ltr") && m.dark === (theme === "dark") && m.sw <= m.cw + 1,
          `${width} ${locale}/${theme} ${name}: dir ${m.dir}, dark ${m.dark}, no page overflow (${m.sw}/${m.cw})${width === 1440 ? `, main ${m.main}px` : ""}`)
        if (width === 1440) assert(m.main > 1100, `${name}: desktop layout uses the width (${m.main}px)`)
        const file = path.join(SHOTS, `p5-${TAG}-${name}-${locale}-${theme}-${width}.png`)
        await page.screenshot({ path: file, fullPage: true })
        shots.push(file)
      }
    }
  }
}

assert(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`)
console.log(`\n${passed} assertions passed; ${shots.length} screenshots in ${SHOTS} (p5-${TAG}-*)`)
await ctx.close()
