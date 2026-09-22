// The Account card on the Me page (MH-343), in a browser: name, picture, email change by code,
// password change, then en/ar × light/dark screenshots.
//
// Same setup as reset-password.mjs (file mail driver, web pointed at a THROWAWAY database):
//   WEB=http://localhost:3019 MAIL_DIR=/tmp/mail node e2e/account.mjs
import { chromium } from "playwright-core"
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3019"
const MAIL_DIR = process.env.MAIL_DIR
if (!MAIL_DIR) throw new Error("set MAIL_DIR to the API's MAIL_DIR")
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
mkdirSync("e2e/shots", { recursive: true })
const log = (...a) => console.log("[account-e2e]", ...a)
let failed = false
const fail = (m) => {
  failed = true
  console.error("[account-e2e] FAIL:", m)
}

const stamp = Date.now()
const email = `account-${stamp}@example.test`
const next = `account-new-${stamp}@example.test`

async function codeFor(to) {
  for (let i = 0; i < 100; i++) {
    for (const f of readdirSync(MAIL_DIR).filter((f) => f.endsWith(".eml")).sort().reverse()) {
      const s = readFileSync(path.join(MAIL_DIR, f), "utf8")
      const m = /^\s{4}(\d{6})\s*$/m.exec(s)
      if (s.includes(`To: ${to}\r\n`) && m) return m[1]
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`no code mailed to ${to}`)
}

// A 1×1 red PNG: enough for the server to decode, crop and re-encode.
const pngPath = path.join(mkdtempSync(path.join(tmpdir(), "avatar-")), "me.png")
writeFileSync(
  pngPath,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"),
)

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "account-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0]
try {
  await page.goto(`${WEB}/en/register`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("account-pass-1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })

  // A workspace to have a Me page in.
  const slug = await page.evaluate(async () => {
    const csrf = (await (await fetch("/api/auth/csrf")).json()).csrf_token
    const r = await fetch("/api/me/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "Account " + Date.now() }),
    })
    return (await r.json()).workspace.slug
  })
  await page.goto(`${WEB}/en/w/${slug}/me`, { waitUntil: "load" })
  const card = page.locator("[data-account-card]")
  await card.getByRole("heading", { name: "Your account" }).waitFor({ timeout: 15000 })
  log("account card shown for", email)

  // Name, saved and still there after a reload.
  await card.getByLabel("Name").fill("Account Tester")
  await card.getByRole("button", { name: "Save profile" }).click()
  await page.getByText("Profile saved").waitFor()
  await page.reload({ waitUntil: "load" })
  if ((await card.getByLabel("Name").inputValue()) !== "Account Tester") fail("the name did not survive a reload")
  log("name saved")

  // A picture, then back to initials.
  if (!(await card.locator("[data-avatar-initials]").isVisible())) fail("no initials before a picture was set")
  await card.locator("#avatar-file").setInputFiles(pngPath)
  await card.locator("[data-avatar]").waitFor({ timeout: 10000 })
  const src = await card.locator("[data-avatar]").getAttribute("src")
  if (!src?.startsWith("data:image/jpeg;base64,")) fail(`avatar src is not the server's JPEG: ${src?.slice(0, 40)}`)
  await page.screenshot({ path: "e2e/shots/account-en-light.png", fullPage: true })
  await card.getByRole("button", { name: "Remove" }).click()
  await card.locator("[data-avatar-initials]").waitFor()
  log("picture uploaded and removed")

  // Email change: a code to the new address, then the card shows it.
  await card.getByRole("button", { name: "Change email" }).click()
  await card.getByLabel("New email").fill(next)
  await card.locator("#acc-email-pw").fill("account-pass-1")
  await card.getByRole("button", { name: "Send a code" }).click()
  await card.getByText(/a code is on its way there/).waitFor()
  await card.locator("#acc-email-code").fill(await codeFor(next))
  await card.getByRole("button", { name: "Confirm new email" }).click()
  await page.getByText("Your email was changed").waitFor()
  if ((await card.locator("[data-current-email]").innerText()).trim() !== next) fail("the card still shows the old address")
  log("email changed to", next)

  // Password: the wrong current one is refused, the right one works.
  await card.locator("#acc-pw-current").fill("not-it-at-all")
  await card.locator("#acc-pw-new").fill("account-pass-2")
  await card.getByRole("button", { name: "Change password" }).click()
  await card.getByText("That password isn't right.").waitFor()
  await card.locator("#acc-pw-current").fill("account-pass-1")
  await card.getByRole("button", { name: "Change password" }).click()
  await page.getByText("Password changed").waitFor()
  log("password changed")

  // Delete: this user is the only owner of their workspace, so it's refused with a link to it.
  const del = page.locator("[data-delete-account]")
  await del.getByRole("button", { name: "Delete my account" }).click()
  await del.locator("#acc-delete-pw").fill("account-pass-2")
  await del.getByRole("button", { name: "Delete account" }).click()
  await del.locator("[data-sole-owner]").waitFor()
  if ((await del.locator("[data-sole-owner] a").count()) !== 1) fail("the sole-owner refusal does not link the workspace")
  await page.screenshot({ path: "e2e/shots/account-delete-refused.png", fullPage: true })
  log("delete refused for the only owner, with the workspace linked")

  // A member who owns nothing can delete: invite one, sign in as them, delete, land on sign-in with
  // the date, sign in again, and the deletion is cancelled.
  const memberEmail = `account-member-${stamp}@example.test`
  const acceptPath = await page.evaluate(async ({ email, slug }) => {
    const csrf = (await (await fetch("/api/auth/csrf")).json()).csrf_token
    const r = await fetch("/api/w/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "X-Workspace-ID": slug },
      body: JSON.stringify({ email, role: "member" }),
    })
    return (await r.json()).accept_url
  }, { email: memberEmail, slug })
  await ctx.clearCookies()
  await page.goto(`${WEB}/en/register`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(memberEmail)
  await page.getByLabel("Password").fill("member-pass-1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  await page.evaluate(async (token) => {
    const csrf = (await (await fetch("/api/auth/csrf")).json()).csrf_token
    await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ token }),
    })
  }, acceptPath.replace("/invite/", ""))
  // Sessions carry whole-second issue times; one made in the same second as the deletion would
  // survive it. A person takes longer than that; the test has to wait for it.
  await page.waitForTimeout(1100)
  await page.goto(`${WEB}/en/w/${slug}/me`, { waitUntil: "load" })
  await del.getByRole("button", { name: "Delete my account" }).click()
  await del.locator("#acc-delete-pw").fill("member-pass-1")
  await del.getByRole("button", { name: "Delete account" }).click()
  await page.waitForURL(/\/login\?deleted=/, { timeout: 15000 })
  await page.locator("[data-deleted-notice]").waitFor()
  await page.screenshot({ path: "e2e/shots/account-deleted-login.png" })
  log("deleted; sign-in page says when:", (await page.locator("[data-deleted-notice]").innerText()).trim())

  await page.getByLabel("Email").fill(memberEmail)
  await page.getByLabel("Password").fill("member-pass-1")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  const back = await page.evaluate(async () => (await fetch("/api/me/profile")).status)
  if (back !== 200) fail(`signing in again did not restore the account (${back})`)
  log("signed in again: deletion cancelled")

  // Back to the owner for the screenshots.
  await ctx.clearCookies()
  await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(next)
  await page.getByLabel("Password").fill("account-pass-2")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })

  for (const locale of ["en", "ar"]) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`${WEB}/${locale}/w/${slug}/me`, { waitUntil: "load" })
      await card.locator("[data-avatar-initials]").waitFor({ timeout: 15000 })
      await page.screenshot({ path: `e2e/shots/account-${locale}-${scheme}.png` })
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`horizontal overflow on ${locale}/${scheme}`)
    }
  }
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[account-e2e] FAIL", e)
  await page.screenshot({ path: "e2e/shots/account-failure.png", fullPage: true }).catch(() => {})
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
