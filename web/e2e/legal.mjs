// The public legal pages (MH-345): reachable signed out, in en/ar × light/dark, with the draft
// notice while the text is unreviewed, the other document one click away, the footer links, the
// consent line on register, and a 404 for anything that isn't one of the two documents.
//   WEB=http://localhost:3019 node e2e/legal.mjs
import { chromium } from "playwright-core"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3019"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
mkdirSync("e2e/shots", { recursive: true })
let failed = false
const fail = (m) => {
  failed = true
  console.error("[legal-e2e] FAIL:", m)
}
const log = (...a) => console.log("[legal-e2e]", ...a)

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "legal-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0]
try {
  for (const locale of ["en", "ar"]) {
    for (const doc of ["privacy", "terms"]) {
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme })
        const res = await page.goto(`${WEB}/${locale}/legal/${doc}`, { waitUntil: "load" })
        if (res?.status() !== 200) fail(`${locale}/${doc}: HTTP ${res?.status()}`)
        if (page.url().includes("/login")) fail(`${locale}/${doc} redirected to sign-in`)
        await page.locator(`[data-legal-doc="${doc}"] h3`).first().waitFor()
        if (!(await page.locator("[data-legal-draft]").isVisible())) fail(`${locale}/${doc}: no draft notice while unreviewed`)
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`${locale}/${doc}/${scheme}: horizontal overflow`)
        await page.screenshot({ path: `e2e/shots/legal-${doc}-${locale}-${scheme}.png`, fullPage: scheme === "light" })
      }
      const title = await page.title()
      const sections = await page.locator(`[data-legal-doc="${doc}"] h3`).count()
      log(`${locale}/${doc}: "${title}", ${sections} sections`)
      if (sections < 6) fail(`${locale}/${doc} has only ${sections} sections`)
    }
    if (locale === "ar" && (await page.evaluate(() => document.documentElement.dir)) !== "rtl") fail("the Arabic page is not rtl")
  }

  // Footer and cross-links.
  await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
  await page.locator("footer").getByRole("link", { name: "Privacy" }).click()
  await page.waitForURL(/\/en\/legal\/privacy$/)
  await page.getByRole("navigation").getByRole("link", { name: "Terms of Service" }).click()
  await page.waitForURL(/\/en\/legal\/terms$/)
  log("footer and cross-links work")

  // Register says what signing up agrees to.
  await page.goto(`${WEB}/ar/register`, { waitUntil: "load" })
  const consent = page.locator("[data-consent]")
  if ((await consent.locator("a").count()) !== 2) fail("the register consent line does not link both documents")
  await page.screenshot({ path: "e2e/shots/legal-register-ar.png" })
  log("register consent:", (await consent.innerText()).trim())

  const bad = await page.goto(`${WEB}/en/legal/cookies`, { waitUntil: "load" })
  if (bad?.status() !== 404) fail(`an unknown document answered ${bad?.status()}, want 404`)
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[legal-e2e] FAIL", e)
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
