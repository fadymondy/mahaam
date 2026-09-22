// Two-factor sign-in (MH-341) in a browser: set it up from the Account card (QR, key, first code,
// recovery codes), sign out, sign in (password → code step → wrong code → right code), sign in
// with a recovery code, then turn it off. Codes are computed from the key the page shows, the
// way an authenticator app computes them.
//   WEB=http://localhost:3019 node e2e/two-factor.mjs
import { chromium } from "playwright-core"
import { createHmac } from "node:crypto"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3019"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
mkdirSync("e2e/shots", { recursive: true })
const log = (...a) => console.log("[2fa-e2e]", ...a)
let failed = false
const fail = (m) => {
  failed = true
  console.error("[2fa-e2e] FAIL:", m)
}

function base32(s) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, "0")
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
function totp(secret, at = Date.now()) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac("sha1", base32(secret)).update(msg).digest()
  const off = h[h.length - 1] & 0x0f
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, "0")
}
// A code may be used once per 30-second step; wait for a fresh one, as a person would.
async function nextStep() {
  const ms = 30_000 - (Date.now() % 30_000) + 300
  log(`waiting ${Math.round(ms / 1000)}s for the next code`)
  await new Promise((r) => setTimeout(r, ms))
}

const email = `twofa-${Date.now()}@example.test`
const password = "twofa-pass-1"
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "twofa-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0]

async function signIn() {
  await ctx.clearCookies()
  await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

try {
  await page.goto(`${WEB}/en/register`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  const slug = await page.evaluate(async () => {
    const csrf = (await (await fetch("/api/auth/csrf")).json()).csrf_token
    const r = await fetch("/api/me/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "Twofa " + Date.now() }),
    })
    return (await r.json()).workspace.slug
  })

  // Setup.
  await page.goto(`${WEB}/en/w/${slug}/me`, { waitUntil: "load" })
  const box = page.locator("[data-two-factor]")
  await box.getByRole("button", { name: "Set up two-factor sign-in" }).click()
  await box.locator("#twofa-pw").fill(password)
  await box.getByRole("button", { name: "Continue" }).click()
  await box.locator("[data-twofa-qr]").waitFor()
  const secret = (await box.locator("[data-twofa-secret]").innerText()).trim()
  await page.screenshot({ path: "e2e/shots/twofa-setup.png", fullPage: true })
  await box.locator("#twofa-code").fill(totp(secret))
  await box.getByRole("button", { name: "Turn on" }).click()
  await box.locator("[data-recovery-codes]").waitFor()
  const recovery = (await box.locator("[data-recovery-codes] li").allInnerTexts()).map((s) => s.trim())
  if (recovery.length !== 10) fail(`${recovery.length} recovery codes shown`)
  await box.getByRole("button", { name: "I've saved them" }).click()
  await box.getByText(/On\. Sign-in asks for a code/).waitFor()
  log("2FA on; 10 recovery codes shown once")

  // Sign in: the password alone isn't enough.
  await signIn()
  const mfa = page.locator("[data-mfa-form]")
  await mfa.waitFor()
  if (page.url().includes("/workspaces")) fail("signed in without the second factor")
  await page.screenshot({ path: "e2e/shots/twofa-login.png" })
  await mfa.locator("#mfa-code").fill(totp(secret) === "000000" ? "111111" : "000000")
  await mfa.getByRole("button", { name: "Verify" }).click()
  await mfa.getByText(/That code isn't right/).waitFor()
  await nextStep()
  await mfa.locator("#mfa-code").fill(totp(secret))
  await mfa.getByRole("button", { name: "Verify" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  log("signed in with password + code")

  // A recovery code, once.
  await signIn()
  await mfa.waitFor()
  await mfa.getByRole("button", { name: "Use a recovery code instead" }).click()
  await mfa.locator("#mfa-code").fill(recovery[0])
  await mfa.getByRole("button", { name: "Verify" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  log("signed in with a recovery code")

  // Arabic, dark: the code step.
  await ctx.clearCookies()
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto(`${WEB}/ar/login`, { waitUntil: "load" })
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.locator("form button[type=submit]").click()
  await mfa.waitFor()
  await page.screenshot({ path: "e2e/shots/twofa-login-ar-dark.png" })
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail("overflow on the ar code step")
  await page.emulateMedia({ colorScheme: "light" })

  // Turn it off with a recovery code.
  await signIn()
  await mfa.waitFor()
  await mfa.getByRole("button", { name: "Use a recovery code instead" }).click()
  await mfa.locator("#mfa-code").fill(recovery[1])
  await mfa.getByRole("button", { name: "Verify" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  await page.goto(`${WEB}/en/w/${slug}/me`, { waitUntil: "load" })
  await box.getByRole("button", { name: "Turn off" }).click()
  await box.locator("#twofa-pw2").fill(password)
  await box.locator("#twofa-recovery").fill(recovery[2])
  await box.getByRole("button", { name: "Turn off" }).click()
  await page.getByText("Two-factor sign-in is off").waitFor()
  await signIn()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  log("turned off; sign-in is one step again")
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[2fa-e2e] FAIL", e)
  await page.screenshot({ path: "e2e/shots/twofa-failure.png", fullPage: true }).catch(() => {})
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
