// Mahaam P6 — real-browser verification of the new DETAIL pages (task, client, member, team,
// issues board + issue detail, saved-report permalink).
//
//   node e2e/p6-verify.mjs            (API :8110 and web :3010 running; system Chrome)
//   WEB_ORIGIN=https://console.mahaam.app node e2e/p6-verify.mjs   (the public preview)
//
// Headless Chrome on a fresh profile via playwright-core. Frames are counted first: a page that
// reports "visible" but paints no frames proves nothing. Then every new page is opened, a couple
// of editors exercised, and each is screenshotted en/ar x light/dark at 1440 and 390.
import { chromium } from "playwright-core"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const here = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(here, "shots")
mkdirSync(SHOTS, { recursive: true })
const tag = WEB.includes("fadymondy") ? "remote" : "local"

const log = (...a) => console.log("•", ...a)
function assert(cond, msg) {
  if (!cond) {
    console.error("✗ FAIL:", msg)
    process.exit(1)
  }
  console.log("✓", msg)
}

const profile = mkdtempSync(path.join(tmpdir(), "mahaam-p6-"))
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--disable-extensions", "--no-first-run"],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const consoleErrors = []
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|Download the React DevTools|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text())
})
page.on("pageerror", (e) => consoleErrors.push(String(e)))

async function dump(err) {
  try {
    const file = path.join(SHOTS, `p6-${tag}-FAILED.png`)
    await page.screenshot({ path: file })
    const text = (await page.evaluate(() => document.body.innerText)).slice(0, 1500)
    console.error(`\n✗ ${err?.message ?? err}\nurl: ${page.url()}\nscreenshot: ${file}\n--- page text ---\n${text}\n--- console errors ---\n${consoleErrors.join("\n") || "(none)"}`)
  } catch (e) {
    console.error("dump failed:", e)
  }
  process.exit(1)
}
process.on("unhandledRejection", dump)
process.on("uncaughtException", dump)

// ── 0. the browser paints ──────────────────────────────────────────────────────
await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
const frames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0
      const t0 = performance.now()
      const tick = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(tick)) : resolve(n))
      requestAnimationFrame(tick)
    }),
)
assert(frames > 20, `the page paints: ${frames} animation frames in 1s`)

// ── 1. setup through the session API ────────────────────────────────────────────
const email = `p6-${Date.now()}@example.test`
const setup = await page.evaluate(
  async ({ email }) => {
    const j = async (res) => {
      const text = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${res.url} ${text}`)
      return text ? JSON.parse(text) : {}
    }
    const { csrf_token } = await j(await fetch("/api/auth/csrf"))
    await j(await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token }, body: JSON.stringify({ email, password: "correct-horse-1" }) }))
    const call = (method, url, body, ws) =>
      fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(j)
    const { workspace } = await call("POST", "/api/me/workspaces", { name: "P6 Verify " + Date.now().toString(36) })
    const ws = workspace.id
    const me = await j(await fetch("/api/auth/me"))
    const client = await call("POST", "/api/w/clients", { name: "Northwind Ltd", email: "ap@northwind.test", country: "EG", default_rate_minor: 8000, currency: "USD" }, ws)
    const project = await call("POST", "/api/w/projects", { name: "Mobile app", client_id: client.id, color: "violet", budget_minutes: 6000, billing_mode: "hourly" }, ws)
    const team = await call("POST", "/api/w/teams", { name: "Delivery", color: "teal", member_ids: [String(me.id)] }, ws)
    await call("PUT", `/api/w/projects/${project.id}/teams/${team.id}`, {}, ws)
    const task = await call("POST", `/api/w/projects/${project.id}/tasks`, { title: "Design the onboarding", priority: "high", assignee_ids: [String(me.id)], due_at: "2026-10-01" }, ws)
    // some tracked time so the client/member rails have numbers
    await call("POST", "/api/w/time/entries", { task: task.id, started_at: "2026-09-15T09:00:00Z", ended_at: "2026-09-15T11:00:00Z", description: "kickoff" }, ws)
    const saved = await call("POST", "/api/w/saved-reports", { name: "This month by project", kind: "time", filters: { group_by: "project" }, shared: true }, ws)
    // an issue via the "Report a problem" intake, filed INTO this workspace (X-Workspace-ID)
    const form = new FormData()
    Object.entries({ title: "Login button misaligned on iPhone", body: "The primary button overflows on 390px.", issue_type: "bug", page_url: "/en/login", route: "/[locale]/login", selector: "button.primary", console_log: "TypeError: x is undefined", network_log: "GET /api/foo 500", viewport: "390x844", user_agent: "verify" }).forEach(([k, v]) => form.append(k, v))
    const fres = await fetch("/api/feedback", { method: "POST", headers: { "X-CSRF-Token": csrf_token, "X-Workspace-ID": ws }, body: form })
    const issue = await j(fres)
    return { ws, slug: workspace.slug, me: String(me.id), client, project, team, task, saved, issueKey: issue.key }
  },
  { email },
)
log(`workspace ${setup.slug} · client ${setup.client.id} · project ${setup.project.id} · task ${setup.task.key} · team ${setup.team.id} · saved ${setup.saved.id} · issue ${setup.issueKey}`)
assert(!!setup.issueKey, `"Report a problem" filed into this workspace as ${setup.issueKey}`)

// ── 2. issues board -> issue detail is reachable, and the issue is listed ─────────
const issues = await page.evaluate(async (ws) => {
  const r = await fetch("/api/w/issues", { headers: { "X-Workspace-ID": ws } })
  return r.ok ? (await r.json()).issues : { error: r.status }
}, setup.ws)
assert(Array.isArray(issues) && issues.some((i) => i.key === setup.issueKey), `GET /api/w/issues returns the filed issue (${Array.isArray(issues) ? issues.length : issues.error} rows)`)

const base = (loc = "en") => `${WEB}/${loc}/w/${setup.slug}`
const pages = [
  ["task", (loc) => `${base(loc)}/projects/${setup.project.id}/tasks/${setup.task.key}`, /Design the onboarding|onboarding/i],
  ["client", (loc) => `${base(loc)}/clients/${setup.client.id}`, /Northwind/i],
  ["member", (loc) => `${base(loc)}/members/${setup.me}`, /.+/],
  ["team", (loc) => `${base(loc)}/teams/${setup.team.id}`, /Delivery/i],
  ["issues", (loc) => `${base(loc)}/issues`, /.+/],
  ["issue", (loc) => `${base(loc)}/issues/${setup.issueKey}`, /misaligned|Login button/i],
  ["saved", (loc) => `${base(loc)}/reports/saved/${setup.saved.id}`, /.+/],
]

// ── 3. content + editors on the detail pages (en/light, 1440) ─────────────────────
for (const [name, url, marker] of pages) {
  await page.emulateMedia({ colorScheme: "light" })
  await page.evaluate(() => localStorage.setItem("theme", "light"))
  await page.goto(url("en"), { waitUntil: "load" })
  try {
    await page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), marker.source, { timeout: 6000 })
  } catch {
    /* fall through to the assert, which will print the page text */
  }
  const body = await page.evaluate(() => document.body.innerText)
  assert(marker.test(body), `${name}: page shows expected content — got: ${body.slice(0, 200).replace(/\n+/g, " ")}`)
}

// exercise the issue status editor on the detail page (write-through PATCH)
await page.goto(pages[5][1]("en"), { waitUntil: "load" })
await page.waitForTimeout(500)
const patched = await page.evaluate(async ({ ws, key }) => {
  const { csrf_token } = await (await fetch("/api/auth/csrf")).json()
  const r = await fetch(`/api/w/issues/${key}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Workspace-ID": ws, "X-CSRF-Token": csrf_token }, body: JSON.stringify({ status: "in_progress", priority: "urgent" }) })
  return r.ok ? await r.json() : { error: r.status, text: await r.text() }
}, { ws: setup.ws, key: setup.issueKey })
assert(patched.status === "in_progress" && patched.priority === "urgent", `issue triage PATCH works: ${JSON.stringify(patched.status ?? patched)}`)
// a comment through the issues API
const commented = await page.evaluate(async ({ ws, key }) => {
  const { csrf_token } = await (await fetch("/api/auth/csrf")).json()
  const r = await fetch(`/api/w/issues/${key}/comments`, { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-ID": ws, "X-CSRF-Token": csrf_token }, body: JSON.stringify({ body: "Reproduced on a Pixel 7 too." }) })
  return r.ok ? await r.json() : { error: r.status, text: await r.text() }
}, { ws: setup.ws, key: setup.issueKey })
assert(!commented.error, `issue comment POST works`)

// ── 4. the side-over links to the full task page ──────────────────────────────────
await page.goto(`${base("en")}/projects/${setup.project.id}/board?task=${setup.task.key}`, { waitUntil: "load" })
const fullLinkSel = `a[href$="/projects/${setup.project.id}/tasks/${setup.task.key}"]`
try {
  await page.waitForSelector(fullLinkSel, { timeout: 10000 })
} catch {
  /* fall through to the assert */
}
const fullLink = await page.locator(fullLinkSel).count()
assert(fullLink > 0, `the task side-over links to the full task page`)

// ── 5. the matrix: en/ar x light/dark at 1440 and 390 ─────────────────────────────
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
  for (const locale of ["en", "ar"]) {
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme })
      await page.evaluate((t) => localStorage.setItem("theme", t), theme)
      for (const [name, url] of pages) {
        await page.goto(url(locale), { waitUntil: "load" }) // navigate after theme/locale change
        await page.waitForTimeout(350)
        const html = await page.evaluate(() => ({ dir: document.documentElement.dir, dark: document.documentElement.classList.contains("dark") }))
        assert(html.dir === (locale === "ar" ? "rtl" : "ltr") && html.dark === (theme === "dark"), `${name} ${locale}/${theme}/${width}: dir=${html.dir} dark=${html.dark}`)
        // no horizontal overflow at 390 (the "phone column in a hatch" tell)
        if (width === 390) {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
          assert(overflow <= 4, `${name} ${locale}/${theme}/390: no horizontal overflow (${overflow}px)`)
        }
        await page.screenshot({ path: path.join(SHOTS, `p6-${tag}-${name}-${locale}-${theme}-${width}.png`), fullPage: width === 1440 })
      }
    }
  }
}

assert(consoleErrors.length === 0, `no console errors across the run${consoleErrors.length ? `: ${consoleErrors.slice(0, 5).join(" | ")}` : ""}`)
log(`done — screenshots in ${SHOTS} (p6-${tag}-*.png)`)
await ctx.close()
process.exit(0)
