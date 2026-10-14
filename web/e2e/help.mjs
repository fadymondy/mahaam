// The public Support and Delete-your-account pages the App Store and Google Play link to:
// reachable signed out, in en/ar × light/dark, on a phone-width screen too, with the support
// email, the developer name, and the links between them, the legal pages and the footer.
//   WEB=http://localhost:3019 node e2e/help.mjs
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
  console.error("[help-e2e] FAIL:", m)
}
const log = (...a) => console.log("[help-e2e]", ...a)

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "help-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0]
try {
  for (const locale of ["en", "ar"]) {
    for (const [doc, slug, min] of [
      ["support", "support", 8],
      ["delete", "delete-account", 6],
    ]) {
      for (const [scheme, width] of [
        ["light", 1280],
        ["dark", 390],
      ]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: scheme })
        const res = await page.goto(`${WEB}/${locale}/${slug}`, { waitUntil: "load" })
        if (res?.status() !== 200) fail(`${locale}/${slug}: HTTP ${res?.status()}`)
        if (page.url().includes("/login")) fail(`${locale}/${slug} redirected to sign-in`)
        await page.locator(`[data-help-doc="${doc}"] h2`).first().waitFor()
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`${locale}/${slug}/${scheme}/${width}: horizontal overflow`)
        // Nothing people read below 12px.
        const tiny = await page.evaluate(() =>
          [...document.querySelectorAll("main *, footer *")]
            .filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
            .map((el) => el.textContent.trim().slice(0, 30)),
        )
        if (tiny.length) fail(`${locale}/${slug}: text below 12px: ${tiny.join(" | ")}`)
        await page.screenshot({ path: `e2e/shots/help-${slug}-${locale}-${scheme}.png`, fullPage: true })
      }
      const sections = await page.locator(`[data-help-doc="${doc}"] h2`).count()
      log(`${locale}/${slug}: "${await page.title()}", ${sections} sections`)
      if (sections < min) fail(`${locale}/${slug} has only ${sections} sections`)
      if ((await page.locator('a[href^="mailto:"]').count()) < 1) fail(`${locale}/${slug}: no support email link`)
      if (locale === "ar" && (await page.evaluate(() => document.documentElement.dir)) !== "rtl") fail("the Arabic page is not rtl")
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })

  const body = await page.goto(`${WEB}/en/delete-account`, { waitUntil: "load" }).then(() => page.locator("main").innerText())
  for (const want of ["Mahaam", "14 days", "only owner"]) if (!body.includes(want)) fail(`the delete page doesn't mention "${want}"`)

  // Footer and cross-links.
  await page.goto(`${WEB}/en/login`, { waitUntil: "load" })
  await page.locator("footer").getByRole("link", { name: "Support", exact: true }).click()
  await page.waitForURL(/\/en\/support$/, { waitUntil: "commit" })
  await page.locator("[data-help-doc] a[href='/en/delete-account']").click()
  await page.waitForURL(/\/en\/delete-account$/, { waitUntil: "commit" })
  await page.goto(`${WEB}/en/legal/privacy`, { waitUntil: "load" })
  await page.locator("#deletion a[href='/en/delete-account']").click()
  await page.waitForURL(/\/en\/delete-account$/, { waitUntil: "commit" })
  log("footer and cross-links work")
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[help-e2e] FAIL", e)
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
