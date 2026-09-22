// Email confirmation on sign-up (MH-342), in a browser: register → the create-workspace form is a
// code form → a wrong code is refused → the mailed code confirms → the workspace can be created.
// Needs the API with EMAIL_VERIFICATION=required and the file mail driver:
//   WEB=http://localhost:3019 MAIL_DIR=/tmp/mail node e2e/verify-email.mjs
import { chromium } from "playwright-core"
import { mkdtempSync, readdirSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3019"
const MAIL_DIR = process.env.MAIL_DIR
if (!MAIL_DIR) throw new Error("set MAIL_DIR to the API's MAIL_DIR")
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
mkdirSync("e2e/shots", { recursive: true })
const log = (...a) => console.log("[verify-e2e]", ...a)
let failed = false
const fail = (m) => {
  failed = true
  console.error("[verify-e2e] FAIL:", m)
}
const email = `verify-${Date.now()}@example.test`

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

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "verify-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0]
try {
  await page.goto(`${WEB}/en/register`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("verify-pass-1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })

  const gate = page.locator("[data-verify-email]")
  await gate.waitFor({ timeout: 10000 })
  await page.screenshot({ path: "e2e/shots/verify-en-light.png", fullPage: true })
  log("the create form asks for the code first")

  const code = await codeFor(email)
  await gate.locator("#verify-code").fill(code === "000000" ? "111111" : "000000")
  await gate.getByRole("button", { name: "Confirm email" }).click()
  await gate.getByText(/isn't valid, or it has expired/).waitFor()
  log("wrong code refused")

  await gate.locator("#verify-code").fill(code)
  await gate.getByRole("button", { name: "Confirm email" }).click()
  await page.getByText("Email confirmed").waitFor()
  if (await gate.isVisible()) fail("the code form is still there after confirming")
  log("confirmed; the create form is back")

  const name = `Verified ${Date.now()}`
  await page.getByLabel(/name/i).first().fill(name)
  await page.getByRole("button", { name: /create/i }).last().click()
  await page.waitForURL(/\/w\//, { timeout: 20000 })
  log("workspace created:", page.url())

  for (const locale of ["ar"]) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`${WEB}/${locale}/workspaces`, { waitUntil: "load" })
      await page.waitForTimeout(500)
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`overflow ${locale}/${scheme}`)
    }
  }
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[verify-e2e] FAIL", e)
  await page.screenshot({ path: "e2e/shots/verify-failure.png", fullPage: true }).catch(() => {})
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
