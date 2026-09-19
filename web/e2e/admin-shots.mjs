// Admin panel screenshots: node e2e/admin-shots.mjs  (API + web running; WEB_ORIGIN, ADMIN_EMAIL, ADMIN_PASSWORD)
// Signs in through the real session API, then captures /admin pages (en/ar x light/dark for the
// dashboard, en light for the rest) into e2e/shots/admin-*.png. Fails on a page error state.
import { chromium } from "playwright-core"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://localhost:3021"
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@mahaam.test"
const PASS = process.env.ADMIN_PASSWORD ?? "correct-horse-9"
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "shots")
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "adm-")), {
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, viewport: { width: 1440, height: 900 },
})
const page = ctx.pages()[0]
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
await page.goto(WEB + "/en/login", { waitUntil: "load" })
const ok = await page.evaluate(async ([email, password]) => {
  const c = await (await fetch("/api/auth/csrf", { credentials: "include" })).json()
  const r = await fetch("/api/auth/login", { method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": c.csrf_token }, body: JSON.stringify({ email, password }) })
  return r.status
}, [EMAIL, PASS])
if (ok !== 200) throw new Error("login " + ok)
const ws = await page.evaluate(async () => (await (await fetch("/api/admin/workspaces", { credentials: "include" })).json()).workspaces)
const first = ws.find((w) => w.slug !== "platform")
const shots = [
  ["dashboard", "/admin"], ["users", "/admin/users"], ["workspaces", "/admin/workspaces"],
  ["workspace", "/admin/workspaces/" + first.id], ["plans", "/admin/plans"], ["plan-pro", "/admin/plans/pro"],
  ["audit", "/admin/audit"], ["settings-plan", `/w/${first.slug}/settings/plan`],
]
for (const locale of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((t) => localStorage.setItem("theme", t), theme)
    for (const [name, p] of shots) {
      if ((locale !== "en" || theme !== "light") && !["dashboard", "workspace", "settings-plan"].includes(name)) continue
      await page.goto(`${WEB}/${locale}${p}`, { waitUntil: "load" })
      await page.waitForTimeout(2500)
      const out = path.join(SHOTS, `admin-${name}-${locale}-${theme}.png`)
      await page.screenshot({ path: out, fullPage: true })
      const info = await page.evaluate(() => ({ dir: document.documentElement.dir, h1: document.querySelector("h1")?.textContent ?? "", notFound: /not found|404/i.test(document.body.innerText.slice(0, 400)) }))
      console.log(name, locale, theme, JSON.stringify(info))
    }
  }
}
if (errors.length) console.log("page errors:", errors)
await ctx.close()
