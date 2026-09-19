// Mahaam P1 — real-browser verification (exit criteria).
//
//   node e2e/p1-verify.mjs            (API :8110 and web :3010 running; system Chrome)
//
// Headless Chrome on a FRESH profile via playwright-core. Frames are counted first: a page that
// reports "visible" but fires no requestAnimationFrame proves nothing about drag-and-drop.
//   1. setup through the real session API (register, workspace, project, label, tasks)
//   2. kanban drag-and-drop with the mouse -> reload -> the card is still in its new column/slot
//   3. Claude-style MCP calls (create_task, move_task, comment_task) -> the card is on the board
//   4. task side-over: checklist add + tick, @mention comment, file upload, activity feed
//   5. en/ar x light/dark screenshots of the board and the side-over (navigate after each theme)
// Exits non-zero on the first failed assertion.
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

const log = (...a) => console.log("•", ...a)
function assert(cond, msg) {
  if (!cond) {
    console.error("✗ FAIL:", msg)
    process.exit(1)
  }
  console.log("✓", msg)
}

const profile = mkdtempSync(path.join(tmpdir(), "mahaam-p1-"))
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--disable-extensions", "--no-first-run"],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const consoleErrors = []
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|Download the React DevTools/i.test(m.text())) consoleErrors.push(m.text())
})
page.on("pageerror", (e) => consoleErrors.push(String(e)))

// On any failure: what the page actually shows, not just "timeout".
async function dump(err) {
  try {
    const file = path.join(SHOTS, "p1-FAILED.png")
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

// ── 0. the browser paints ─────────────────────────────────────────────────────
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

// ── 1. setup through the session API (same cookies the UI uses) ─────────────────
const email = `p1-${Date.now()}@example.test`
const local = email.split("@")[0]
const setup = await page.evaluate(
  async ({ email }) => {
    const j = async (res) => {
      const text = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${res.url} ${text}`)
      return text ? JSON.parse(text) : {}
    }
    // Same order as the app's api() wrapper: the login page already set the togo_csrf cookie,
    // so every cookie-bearing mutation — register included — must echo it in X-CSRF-Token.
    const { csrf_token } = await j(await fetch("/api/auth/csrf"))
    await j(await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token }, body: JSON.stringify({ email, password: "correct-horse-1" }) }))
    const call = (method, url, body, ws) =>
      fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token, ...(ws ? { "X-Workspace-ID": ws } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(j)
    const { workspace } = await call("POST", "/api/me/workspaces", { name: "P1 Verify " + Date.now().toString(36) })
    const ws = workspace.id
    const me = await j(await fetch("/api/auth/me"))
    const client = await call("POST", "/api/w/clients", { name: "Acme Trading", email: "ops@acme.test", country: "EG" }, ws)
    const project = await call("POST", "/api/w/projects", { name: "Website relaunch", client_id: client.id, color: "teal", budget_minutes: 6000 }, ws)
    const label = await call("POST", "/api/w/labels", { name: "design", color: "pink" }, ws)
    await call("POST", "/api/w/labels", { name: "bug", color: "red" }, ws)
    const [todo, doing, review, done] = project.statuses
    const mk = (title, extra = {}) => call("POST", `/api/w/projects/${project.id}/tasks`, { title, ...extra }, ws)
    const a = await mk("Wireframe the home page", { label_ids: [label.id], assignee_ids: [String(me.id)], priority: "high", due_at: "2026-09-30" })
    const b = await mk("Write the launch checklist", { priority: "medium" })
    const c = await mk("Pick a hosting plan", { status: doing.id })
    await mk("Draft the brand voice", { status: review.id, priority: "low" })
    await mk("Kick-off call", { status: done.id })
    await call("POST", `/api/w/tasks/${b.key}/checklist`, { title: "Domain" }, ws)
    await call("POST", `/api/w/tasks/${b.key}/checklist`, { title: "Analytics" }, ws)
    const token = await call("POST", "/api/w/mcp_tokens", { name: "claude p1 verify", scopes: ["projects:read", "tasks:read", "tasks:write", "members:read"] }, ws)
    return { ws, slug: workspace.slug, project, todo, doing, done, a, b, c, token: token.plaintext }
  },
  { email },
)
log(`workspace ${setup.slug}, project ${setup.project.id}, tasks ${setup.a.key} ${setup.b.key} ${setup.c.key}`)
const boardUrl = (locale = "en") => `${WEB}/${locale}/w/${setup.slug}/projects/${setup.project.id}/board`
const card = (key) => page.locator(`[data-task-key="${key}"]`)
const column = (id) => page.locator(`[data-status-id="${id}"]`)

// ── 2. drag-and-drop persists across reload ───────────────────────────────────────
await page.goto(boardUrl(), { waitUntil: "load" })
await card(setup.a.key).waitFor()
assert((await page.title()).startsWith("Board · Website relaunch"), `board sets its title: "${await page.title()}"`)
const from = await card(setup.a.key).boundingBox()
const target = await card(setup.c.key).boundingBox() // drop onto the top card of In progress
const moveDone = page.waitForResponse((r) => r.url().endsWith(`/api/w/tasks/${setup.a.key}/move`) && r.request().method() === "POST")
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
await page.mouse.down()
for (let i = 1; i <= 24; i++) {
  await page.mouse.move(from.x + from.width / 2 + ((target.x - from.x) * i) / 24, from.y + from.height / 2 + (target.y + 8 - (from.y + from.height / 2)) * (i / 24))
  await page.waitForTimeout(16)
}
await page.mouse.up()
const moveRes = await moveDone
const moveBody = moveRes.request().postDataJSON()
assert(moveRes.status() === 200, `drop persisted through POST …/move (status ${moveRes.status()}, body ${JSON.stringify(moveBody)})`)
await page.reload({ waitUntil: "load" })
await card(setup.a.key).waitFor()
const inDoing = await column(setup.doing.id).locator(`[data-task-key]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-task-key")))
assert(inDoing.includes(setup.a.key), `after reload ${setup.a.key} is in "In progress": [${inDoing.join(", ")}]`)
assert(inDoing[moveBody.index ?? inDoing.length - 1] === setup.a.key, `…at the dropped position ${moveBody.index} (order ${inDoing.join(" > ")})`)

// ── 3. Claude-style MCP calls land on the board ───────────────────────────────────
const mcp = async (name, args) => {
  const res = await fetch(`${WEB}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${setup.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
  })
  const out = await res.json()
  const text = out.result?.content?.[0]?.text ?? JSON.stringify(out)
  if (out.result?.isError || !res.ok) throw new Error(`${name}: ${text}`)
  return text
}
const created = await mcp("create_task", { project: "Website relaunch", title: "Audit page speed (filed by Claude)", assignees: ["me"], labels: ["bug"], priority: "urgent" })
const mcpKey = created.match(/MG-\d+/)[0]
log(`create_task -> ${created.split("\n")[0]}`)
log(`move_task -> ${await mcp("move_task", { key: mcpKey, status: "Done" })}`)
log(`comment_task -> ${await mcp("comment_task", { key: mcpKey, body: `Lighthouse run attached next. @${local} FYI` })}`)
await page.reload({ waitUntil: "load" })
await card(mcpKey).waitFor()
const doneKeys = await column(setup.done.id).locator("[data-task-key]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task-key")))
assert(doneKeys.includes(mcpKey), `${mcpKey} created over MCP renders in Done: [${doneKeys.join(", ")}]`)

// ── 4. the task side-over ───────────────────────────────────────────────────────────
await card(setup.b.key).click()
const sheet = page.locator(`[data-task-sheet="${setup.b.key}"]`)
await sheet.getByText("Checklist", { exact: true }).waitFor()
assert(new URL(page.url()).searchParams.get("task") === setup.b.key, `clicking a card opens the side-over (?task=${setup.b.key})`)
await sheet.getByPlaceholder("Add an item").fill("Launch email")
await sheet.getByPlaceholder("Add an item").press("Enter")
await sheet.locator("[data-checklist] li", { hasText: "Launch email" }).waitFor()
await sheet.locator("[data-checklist] li", { hasText: "Domain" }).getByRole("checkbox").click()
await page.waitForResponse((r) => r.url().includes("/api/w/checklist/") && r.request().method() === "PATCH")
await sheet.getByText("1/3").first().waitFor()
assert(true, "checklist: item added and ticked (1/3)")
const box = sheet.getByPlaceholder("Write a comment…")
await box.click()
await box.pressSequentially(`Needs sign-off from @${local.slice(0, 6)}`)
await sheet.getByRole("option").first().waitFor()
await box.press("Enter") // picks the highlighted suggestion
await box.pressSequentially("before launch.")
await sheet.getByRole("button", { name: "Comment", exact: true }).click()
await sheet.locator("[data-mention]").first().waitFor()
assert((await sheet.locator("[data-mention]").first().textContent()) === `@${local}`, `@mention autocompleted and highlighted (@${local})`)
const fileInput = sheet.locator("[data-dropzone] input[type=file]")
await fileInput.setInputFiles({ name: "launch-plan.txt", mimeType: "text/plain", buffer: Buffer.from("Launch plan — P1 verify\n") })
await sheet.locator("[data-attachments] li", { hasText: "launch-plan.txt" }).waitFor()
assert(true, "attachment uploaded through the dropzone and listed")
await sheet.locator('[data-action="comment.added"]').first().waitFor()
const actions = await sheet.locator("[data-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-action")))
assert(["attachment.added", "comment.added", "checklist.checked", "checklist.added", "task.created"].every((a) => actions.includes(a)), `activity feed shows the side-over's changes: ${actions.join(", ")}`)

// ── 5. en/ar x light/dark: board + side-over ─────────────────────────────────────────
const shots = []
for (const locale of ["en", "ar"]) {
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme })
    await page.evaluate((t) => localStorage.setItem("theme", t), theme)
    await page.goto(boardUrl(locale), { waitUntil: "load" }) // navigate after a theme change
    await card(mcpKey).waitFor()
    const html = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, dark: document.documentElement.classList.contains("dark"), bg: getComputedStyle(document.body).backgroundColor }))
    assert(html.dir === (locale === "ar" ? "rtl" : "ltr") && html.dark === (theme === "dark"), `${locale}/${theme}: dir=${html.dir} dark=${html.dark} body bg ${html.bg}`)
    const b = path.join(SHOTS, `p1-board-${locale}-${theme}.png`)
    await page.screenshot({ path: b })
    await page.goto(`${boardUrl(locale)}?task=${setup.b.key}`, { waitUntil: "load" })
    await page.locator(`[data-task-sheet="${setup.b.key}"] [data-attachments]`).waitFor()
    await page.waitForTimeout(400) // sheet enter transition (the page paints: counted above)
    const side = await page.locator(`[data-task-sheet="${setup.b.key}"]`).boundingBox()
    assert(locale === "ar" ? side.x < 50 : side.x + side.width > 1390, `${locale}/${theme}: side-over opens from the ${locale === "ar" ? "left (RTL end)" : "right"} (x=${Math.round(side.x)})`)
    const s = path.join(SHOTS, `p1-sheet-${locale}-${theme}.png`)
    await page.screenshot({ path: s })
    shots.push(b, s)
  }
}
assert((await page.title()).includes("Website relaunch"), `ar board keeps a document title: "${await page.title()}"`)

// Other P1 routes render and set their titles (en, light).
await page.emulateMedia({ colorScheme: "light" })
await page.evaluate(() => localStorage.setItem("theme", "light"))
for (const [route, want] of [
  ["projects", "Projects ·"],
  [`projects/${setup.project.id}`, "Overview · Website relaunch"],
  [`projects/${setup.project.id}/list`, "List · Website relaunch"],
  [`projects/${setup.project.id}/settings`, "Settings · Website relaunch"],
  ["clients", "Clients ·"],
  ["teams", "Teams ·"],
  ["settings/labels", "Labels ·"],
  ["", "Overview ·"],
]) {
  await page.goto(`${WEB}/en/w/${setup.slug}/${route}`, { waitUntil: "load" })
  await page.waitForFunction((w) => document.title.startsWith(w), want, { timeout: 10000 })
  assert(true, `/${route || "(overview)"} renders, title "${await page.title()}"`)
}
await page.screenshot({ path: path.join(SHOTS, "p1-overview-en-light.png") })

assert(consoleErrors.length === 0, `no console errors${consoleErrors.length ? ": " + consoleErrors.join(" | ") : ""}`)
console.log("\nscreenshots:\n" + shots.map((s) => "  " + s).join("\n"))
await ctx.close()
