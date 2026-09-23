// Google/GitHub sign-ins that come back to the login page (internal/server/oauth_return.go), and
// the app hand-off through it. The API is stubbed in the browser, so this needs only the web:
//   - ?error=account_suspended / ?error=oauth_failed show their message (en + ar);
//   - ?error=mfa_required&next=…#mfa_challenge=… opens the two-factor step with that challenge,
//     strips the fragment, posts {challenge, code} and continues to `next` (the app-signin page);
//   - a signed-out /{locale}/app-signin?… lands on login, whose provider buttons carry the whole
//     app-signin URL as `next` to /api/auth/oauth/<provider>.
//   WEB=http://localhost:3019 node e2e/oauth-return.mjs
import { chromium } from "playwright-core"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const WEB = process.env.WEB ?? "http://localhost:3019"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
let failed = false
const fail = (m) => {
  failed = true
  console.error("[oauth-return-e2e] FAIL:", m)
}
const log = (...a) => console.log("[oauth-return-e2e]", ...a)

const APP_SIGNIN_QUERY = new URLSearchParams({
  redirect_uri: "mahaam://auth/callback",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "0123456789abcdef0123",
  device: "Test iPhone",
}).toString()

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "oauth-return-")), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0]
let signedIn = false
let challengeBody = null
await ctx.route("**/api/**", async (route) => {
  const url = new URL(route.request().url())
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
  switch (url.pathname) {
    case "/api/auth/methods":
      return json(200, { methods: [{ type: "password", name: "password" }, { type: "oauth", name: "google", label: "Google", url: "/api/auth/oauth/google" }] })
    case "/api/auth/csrf":
      return json(200, { csrf_token: "t" })
    case "/api/auth/me":
      return signedIn ? json(200, { id: "u1", email: "me@example.com", name: "Me" }) : json(401, { error: "unauthorized" })
    case "/api/auth/2fa/challenge":
      challengeBody = route.request().postDataJSON()
      signedIn = true
      return json(200, { ok: true })
    default:
      return json(404, { error: "stubbed" })
  }
})

try {
  for (const [locale, suspended, failedMsg] of [
    ["en", "This account is suspended", "Signing in with that account didn't work"],
    ["ar", "هذا الحساب موقوف", "تعذّر تسجيل الدخول"],
  ]) {
    await page.goto(`${WEB}/${locale}/login?error=account_suspended`, { waitUntil: "load" })
    if (!(await page.getByText(suspended).isVisible())) fail(`${locale}: no suspended message`)
    if (!(await page.locator(`[data-suspended-support][href="/${locale}/support"]`).isVisible())) fail(`${locale}: no support link`)
    await page.goto(`${WEB}/${locale}/login?error=oauth_failed`, { waitUntil: "load" })
    if (!(await page.getByText(failedMsg).isVisible())) fail(`${locale}: no oauth_failed message`)
  }
  log("error messages shown")

  // Unprefixed, exactly as the API redirects: proxy.ts adds the locale, the fragment rides along.
  const next = `/en/app-signin?${APP_SIGNIN_QUERY}`
  await page.goto(`${WEB}/login?error=mfa_required&next=${encodeURIComponent(next)}#mfa_challenge=sealed-challenge-123`, { waitUntil: "load" })
  await page.locator("[data-mfa-form]").waitFor()
  if (!(await page.locator("[data-oauth-mfa]").isVisible())) fail("no 'provider worked, now your code' hint")
  if (page.url().includes("#")) fail(`fragment not stripped: ${page.url()}`)
  if (!page.url().includes("next=")) fail(`next lost from the URL: ${page.url()}`)
  // The real API sets the session cookie on this call; the stub can't, so it's set here.
  await ctx.addCookies([{ name: "togo_session", value: "stub", url: WEB }])
  await page.locator("#mfa-code").fill("123456")
  await page.locator("[data-mfa-form] button[type=submit]").click()
  await page.waitForURL((u) => u.pathname === "/en/app-signin", { waitUntil: "commit" })
  if (challengeBody?.challenge !== "sealed-challenge-123" || challengeBody?.code !== "123456") fail(`challenge body ${JSON.stringify(challengeBody)}`)
  if (new URL(page.url()).search.slice(1) !== APP_SIGNIN_QUERY) fail(`app-signin query changed: ${page.url()}`)
  await page.locator("[data-app-signin-continue]").waitFor()
  log("mfa_required: two-factor step with the challenge, then on to app-signin")

  // No cookie: proxy.ts sends app-signin through login; the Google button must bring it back.
  signedIn = false
  await ctx.clearCookies()
  await page.goto(`${WEB}/en/app-signin?${APP_SIGNIN_QUERY}`, { waitUntil: "load" })
  if (new URL(page.url()).pathname !== "/en/login") fail(`signed-out app-signin went to ${page.url()}`)
  const href = await page.locator('a[href^="/api/auth/oauth/google"]').getAttribute("href")
  const target = new URL(href, WEB)
  if (target.pathname !== "/api/auth/oauth/google") fail(`provider href ${href}`)
  if (target.searchParams.get("next") !== `/en/app-signin?${APP_SIGNIN_QUERY}`) fail(`provider next ${target.searchParams.get("next")}`)
  log("provider button next:", target.searchParams.get("next"))

  for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example"]) {
    await page.goto(`${WEB}/en/login?next=${encodeURIComponent(bad)}`, { waitUntil: "load" })
    const n = new URL(await page.locator('a[href^="/api/auth/oauth/google"]').getAttribute("href"), WEB).searchParams.get("next")
    if (n !== "/en/workspaces") fail(`unsafe next ${bad} was kept as ${n}`)
  }
  log("unsafe next values fall back to /en/workspaces")
  log(failed ? "FAIL" : "PASS")
} catch (e) {
  failed = true
  console.error("[oauth-return-e2e] FAIL", e)
} finally {
  await ctx.close()
  process.exitCode = failed ? 1 : 0
}
