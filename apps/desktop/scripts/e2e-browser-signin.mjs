// Google/GitHub/Apple sign-in happens in the SYSTEM browser and redirects back (RFC 8252).
// Drives it for real: the app's "Continue with Google or GitHub" opens the browser (intercepted
// here and handed to a real Chrome), the web's sign-in and the app-signin confirmation run in that
// Chrome, the browser is redirected to the app's loopback port, and the app ends up signed in
// with its own device token.
//   MAHAAM_API_URL=http://127.0.0.1:3020 CHROME=/path/to/chrome E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-browser-signin.mjs
import { _electron as electron, chromium } from "playwright-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = process.env.MAHAAM_API_URL ?? "http://127.0.0.1:3020";
const { E2E_EMAIL: EMAIL, E2E_PASSWORD: PASSWORD, CHROME } = process.env;
if (!EMAIL || !PASSWORD || !CHROME) throw new Error("set E2E_EMAIL, E2E_PASSWORD and CHROME");
const { ELECTRON_RUN_AS_NODE: _drop, ...env } = process.env;
const log = (...a) => console.log("[browser-signin]", ...a);
const fail = (m) => {
  throw new Error(m);
};

const app = await electron.launch({ args: ["."], env: { ...env, MAHAAM_E2E: "1", MAHAAM_API_URL: API, MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-desktop-")) } });
const browser = await chromium.launch({ executablePath: CHROME });
try {
  // The "system browser": capture what the app asks the OS to open.
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (u) => void globalThis.__opened.push(u);
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("load");
  await page.locator("[data-signin-browser]").click();
  await page.locator("[data-signin-waiting]").waitFor({ timeout: 5000 });
  const url = await (async () => {
    for (let i = 0; i < 40; i++) {
      const u = await app.evaluate(() => globalThis.__opened[0]);
      if (u) return u;
      await new Promise((r) => setTimeout(r, 100));
    }
    fail("the app did not open the browser");
  })();
  const u = new URL(url);
  log("opened in the system browser:", u.pathname, "redirect_uri =", u.searchParams.get("redirect_uri"));
  if (!/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(u.searchParams.get("redirect_uri") ?? "")) fail("not a loopback redirect");
  if (u.searchParams.get("code_challenge_method") !== "S256") fail("no PKCE");
  // Our own windows load our files (?surface=…); a window on a web page would be an embedded sign-in.
  const web = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()).filter((u) => /^https?:/.test(u) && !u.includes("surface=")));
  if (web.length) fail(`an embedded sign-in window was opened: ${web.join(", ")}`);

  // In the browser: not signed in → the web's sign-in → back to app-signin → confirm.
  const tab = await (await browser.newContext()).newPage();
  await tab.goto(url);
  await tab.locator("#email").waitFor({ timeout: 20000 });
  log("browser: sent to the web sign-in first");
  await tab.locator("#email").fill(EMAIL);
  await tab.locator("#password").fill(PASSWORD);
  await tab.locator("form button[type=submit]").click();
  await tab.locator("[data-app-signin-continue]").waitFor({ timeout: 20000 });
  log("browser: back on the app-signin page, confirming");
  await tab.locator("[data-app-signin-continue]").click();
  await tab.waitForURL(/127\.0\.0\.1:\d+\/callback/, { timeout: 15000 });
  const said = await tab.locator("h1").innerText();
  log("browser landed on the app's loopback page:", JSON.stringify(said));

  await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
  const s = await page.evaluate(() => window.mahaam.invoke("session:get"));
  log("app signed in as", s.value.email);
  if (s.value.email !== EMAIL) fail("signed in as the wrong account");
  log("PASS");
} finally {
  await browser.close().catch(() => {});
  await app.close().catch(() => {});
}
