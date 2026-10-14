// Forgot password, end to end in a browser (MH-340): register → sign out → "Forgot password?" →
// read the code out of the mail the API wrote → new password → signed in.
//
// Needs the API with the file mail driver and the web app pointed at it:
//   MAIL_DRIVER=file MAIL_DIR=/tmp/mail go run ./cmd/api serve     (against a THROWAWAY database)
//   API_ORIGIN=http://localhost:8119 npx next dev -p 3019
//   WEB=http://localhost:3019 MAIL_DIR=/tmp/mail node e2e/reset-password.mjs
import { chromium } from "playwright-core"
import { mkdtempSync, readdirSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3019"
const MAIL_DIR = process.env.MAIL_DIR
if (!MAIL_DIR) throw new Error("set MAIL_DIR to the API's MAIL_DIR")
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
mkdirSync("e2e/shots", { recursive: true })

const email = `reset-${Date.now()}@example.test`
const log = (...a) => console.log("[reset-e2e]", ...a)

// The newest message to `to`, waited for: the API sends after it has answered.
async function codeFor(to, seen) {
  for (let i = 0; i < 100; i++) {
    const files = readdirSync(MAIL_DIR).filter((f) => f.endsWith(".eml")).sort()
    for (const f of files.reverse()) {
      if (seen.has(f)) continue
      const s = readFileSync(path.join(MAIL_DIR, f), "utf8")
      const m = /^\s{4}(\d{6})\s*$/m.exec(s)
      if (s.includes(`To: ${to}\r\n`) && m) {
        seen.add(f)
        return m[1]
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`no code mailed to ${to}`)
}

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "reset-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 860 },
})
const page = ctx.pages()[0]
let failed = false
try {
  await page.goto(`${WEB}/en/register`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill("old-password-1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  log("registered", email)

  await ctx.clearCookies()
  await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
  await page.getByRole("link", { name: "Forgot password?" }).click()
  await page.waitForURL(/\/forgot-password/)
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Email me a code" }).click()
  await page.getByText(/a code is on its way/).waitFor()
  await page.screenshot({ path: "e2e/shots/reset-code-en-light.png" })

  const seen = new Set()
  const code = await codeFor(email, seen)
  log("code arrived by mail")

  // A wrong code first: the page must say so and keep the form.
  await page.getByLabel("Code from the email").fill(code === "000000" ? "111111" : "000000")
  await page.getByLabel("New password").fill("new-password-2")
  await page.getByRole("button", { name: "Set new password" }).click()
  await page.getByText(/isn't valid, or it has expired/).waitFor()
  log("wrong code refused")

  await page.getByLabel("Code from the email").fill(code)
  await page.getByRole("button", { name: "Set new password" }).click()
  await page.waitForURL(/\/workspaces/, { timeout: 20000 })
  log("reset and signed in with the new password")

  // The old password is dead.
  await ctx.clearCookies()
  await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByLabel("Password").fill("old-password-1")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.getByText(/don't match an account/).waitFor()
  log("old password refused")

  // en/ar × light/dark of both steps.
  for (const locale of ["en", "ar"]) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`${WEB}/${locale}/forgot-password`, { waitUntil: "load" })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `e2e/shots/reset-${locale}-${scheme}.png` })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      if (overflow) {
        failed = true
        console.error(`[reset-e2e] FAIL: horizontal overflow on ${locale}/${scheme}`)
      }
    }
  }
  const dir = await page.evaluate(() => document.documentElement.dir)
  if (dir !== "rtl") {
    failed = true
    console.error("[reset-e2e] FAIL: the Arabic page is not rtl:", dir)
  }
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[reset-e2e] FAIL", e)
  await page.screenshot({ path: "e2e/shots/reset-failure.png" }).catch(() => {})
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
