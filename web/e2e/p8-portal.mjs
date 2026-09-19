// P7 browser verification + screenshots: the client portal, a client-filed issue,
// and the project feedback-widget settings — en/ar x light/dark x 1440/390.
//
//   cd web && node e2e/p8-portal.mjs          (local: WEB_ORIGIN defaults to :3010)
//   WEB_ORIGIN=https://console.mahaam.app node e2e/p8-portal.mjs   (public)
//
// A real painting Chrome (headless=true but the system Chrome binary) so
// requestAnimationFrame runs and Base UI clears its starting styles.
import { chromium } from "playwright-core"
import { mkdirSync, rmSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const WEB = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3010"
const here = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(here, "shots")
mkdirSync(SHOTS, { recursive: true })
rmSync(path.join(SHOTS, "p8-FAILED.png"), { force: true })

const log = (...a) => console.log("•", ...a)
let pageForDump = null
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  console.log("✓", msg)
}
async function dump(err) {
  try {
    if (pageForDump) await pageForDump.screenshot({ path: path.join(SHOTS, "p8-FAILED.png") })
    const text = pageForDump ? (await pageForDump.evaluate(() => document.body.innerText)).slice(0, 1200) : ""
    console.error(`\n✗ FAIL: ${err?.message ?? err}\nurl: ${pageForDump?.url()}\n--- page text ---\n${text}`)
  } catch (e) {
    console.error("✗ FAIL:", err, "(dump failed:", e, ")")
  }
  process.exit(1)
}
process.on("unhandledRejection", dump)
process.on("uncaughtException", dump)

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const launch = () =>
  chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "mahaam-p8-")), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-extensions", "--no-first-run"],
  })

// setup runs API calls from inside a page (same-origin cookies + CSRF).
async function apiSetup(page, fn, arg) {
  return page.evaluate(async ({ fn, arg }) => {
    const j = async (res) => {
      const t = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${res.url} ${t}`)
      return t ? JSON.parse(t) : {}
    }
    const { csrf_token } = await j(await fetch("/api/auth/csrf"))
    const H = (ws) => ({ "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) })
    const call = (m, u, b, ws) => fetch(u, { method: m, headers: H(ws), body: b ? JSON.stringify(b) : undefined }).then(j)
    // eslint-disable-next-line no-new-func
    return await new Function("call", "j", "H", "arg", `return (${fn})(call, j, H, arg)`)(call, j, H, arg)
  }, { fn: fn.toString(), arg })
}

const ownerCtx = await launch()
const O = ownerCtx.pages()[0] ?? (await ownerCtx.newPage())
pageForDump = O
await O.goto(`${WEB}/en/login`, { waitUntil: "load" })
const frames = await O.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (performance.now() - t0 < 1000 ? (n++, requestAnimationFrame(f)) : r(n)); requestAnimationFrame(f) }))
assert(frames > 20, `owner tab paints: ${frames} frames/s`)

const stamp = Date.now().toString(36)
const ownerEmail = `p8-owner-${stamp}@example.test`
const clientEmail = `p8-client-${stamp}@example.test`

const setup = await apiSetup(
  O,
  async (call, j, H, arg) => {
    await call("POST", "/api/auth/register", { email: arg.ownerEmail, password: "correct-horse-1" })
    const { workspace } = await call("POST", "/api/me/workspaces", { name: "Portal Demo " + arg.stamp })
    const ws = workspace.id
    const client = await call("POST", "/api/w/clients", { name: "Acme Corp", email: "ap@acme.test" }, ws)
    const project = await call("POST", "/api/w/projects", { name: "Acme website", client_id: client.id, color: "teal", visibility: "members" }, ws)
    await call("POST", `/api/w/projects/${project.id}/feedback-keys`, { name: "Website widget", allowed_origins: ["https://acme.test"] }, ws)
    const inv = await call("POST", "/api/w/invitations", { email: arg.clientEmail, role: "client" }, ws)
    const token = inv.accept_url.split("/").pop()
    return { ws, slug: workspace.slug, client: client.id, project: project.id, token }
  },
  { ownerEmail, clientEmail, stamp },
)
log(`workspace ${setup.slug}, project ${setup.project}`)

// The client accepts the invitation and gets linked as a portal contact.
const clientCtx = await launch()
const C = clientCtx.pages()[0] ?? (await clientCtx.newPage())
watchErrors(C, "client")
await C.goto(`${WEB}/en/login`, { waitUntil: "load" })
await apiSetup(
  C,
  async (call, j, H, arg) => {
    await call("POST", "/api/auth/register", { email: arg.clientEmail, password: "correct-horse-2" })
    await call("POST", "/api/invitations/accept", { token: arg.token })
  },
  { clientEmail, token: setup.token },
)
// Owner resolves the client's user id from the members list and links it.
await apiSetup(
  O,
  async (call, j, H, arg) => {
    const { members } = await call("GET", "/api/w/members", null, arg.ws)
    const m = members.find((x) => x.email === arg.clientEmail)
    await call("PUT", `/api/w/clients/${arg.client}/contacts/${m.user_id}`, null, arg.ws)
  },
  { ws: setup.ws, client: setup.client, clientEmail },
)
log("client linked as a portal contact")

const errors = []
function watchErrors(p, name) {
  p.on("pageerror", (e) => errors.push(`${name}: ${e}`))
}
watchErrors(O, "owner")

const ownerUrl = (p, locale = "en") => `${WEB}/${locale}/w/${setup.slug}${p}`

// The client files an issue through the portal, so "a client issue" screenshot has content.
await C.goto(`${WEB}/en/w/${setup.slug}/portal`, { waitUntil: "load" })
await C.getByText("Your portal").waitFor({ timeout: 15000 })
assert(true, "the client sees the portal")
await C.getByRole("button", { name: /File an issue/i }).click()
await C.getByRole("heading", { name: "File an issue" }).waitFor()
await C.locator('input[maxlength="200"]').first().fill("The contact form does not submit")
await C.getByRole("button", { name: /^Send$/ }).click()
await C.getByText(/contact form does not submit/i).waitFor({ timeout: 15000 })
assert(true, "the client filed an issue and it appears in their portal")

// ── screenshots: portal · client issue · feedback settings — en/ar x light/dark x 1440/390
const shots = []
async function theme(page, locale, mode, url) {
  await page.emulateMedia({ colorScheme: mode })
  await page.evaluate((t) => localStorage.setItem("theme", t), mode)
  await page.goto(url, { waitUntil: "load" })
}
for (const width of [1440, 390]) {
  await O.setViewportSize({ width, height: 900 })
  await C.setViewportSize({ width, height: 900 })
  for (const locale of ["en", "ar"]) {
    for (const mode of ["light", "dark"]) {
      // Portal (client)
      await theme(C, locale, mode, `${WEB}/${locale}/w/${setup.slug}/portal`)
      await C.getByText(locale === "ar" ? /البوابة|Your portal/ : /Your portal/).first().waitFor({ timeout: 15000 }).catch(() => {})
      const portal = path.join(SHOTS, `p8-portal-${locale}-${mode}-${width}.png`)
      await C.screenshot({ path: portal, fullPage: true })
      shots.push(portal)

      // Feedback-widget settings (owner)
      await theme(O, locale, mode, ownerUrl(`/projects/${setup.project}/settings`, locale))
      await O.getByText(/Client access|الوصول/i).first().waitFor({ timeout: 15000 }).catch(() => {})
      const set = path.join(SHOTS, `p8-feedback-settings-${locale}-${mode}-${width}.png`)
      await O.screenshot({ path: set, fullPage: true })
      shots.push(set)

      // A client issue (owner's issues board shows the portal-filed issue)
      await theme(O, locale, mode, ownerUrl(`/issues`, locale))
      await O.waitForTimeout(400)
      const issue = path.join(SHOTS, `p8-client-issue-${locale}-${mode}-${width}.png`)
      await O.screenshot({ path: issue, fullPage: true })
      shots.push(issue)
    }
  }
}

assert(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`)
console.log(`\n${shots.length} screenshots in ${SHOTS}`)
await ownerCtx.close()
await clientCtx.close()
