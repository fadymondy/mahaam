// Loads dist/ as an unpacked extension in Chrome/Chromium and drives the popup page against a
// running API: sign in → start timer → badge → stop → context-menu hand-off (file an issue).
//   MAHAAM_API_URL=http://localhost:8120 npm run build        (grants the dev host at install)
//   CHROME=/path/to/chromium E2E_EMAIL=... E2E_PASSWORD=... node scripts/e2e.mjs
// Branded Google Chrome 137+ ignores --load-extension; use Chromium or Chrome for Testing.
import { chromium } from "playwright-core";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WS = process.env.E2E_WORKSPACE ?? "tray-dev";
if (!EMAIL || !PASSWORD) throw new Error("set E2E_EMAIL and E2E_PASSWORD");
const dist = resolve("dist");
mkdirSync("e2e-shots", { recursive: true });
const log = (...a) => console.log("[ext-e2e]", ...a);
// Collected rather than thrown, so one security assertion failing still lets the rest of the run
// report what else is wrong. The exit code at the end is what CI reads.
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error("[ext-e2e] FAIL:", msg);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "mahaam-ext-")), {
  executablePath: process.env.CHROME,
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--disable-features=DisableLoadExtensionCommandLineSwitch"],
  viewport: { width: 380, height: 640 },
});
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(sw.url()).host;
  log("service worker up:", sw.url());

  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await Promise.race([page.getByText("Next up").waitFor({ timeout: 15000 }), page.getByRole("button", { name: new RegExp(WS) }).first().click({ timeout: 15000 })]).catch(() => null);
  await page.getByText("Next up").waitFor({ timeout: 15000 });
  // What sign-in leaves behind, and where. storage.local is the profile directory on disk;
  // storage.session is memory only and dies with the browser. Nothing that authenticates anyone
  // may end up in the first one.
  const local = await sw.evaluate(() => chrome.storage.local.get(null));
  const sessionArea = await sw.evaluate(() => chrome.storage.session.get(null));
  log("signed in; local keys:", Object.keys(local).sort().join(",") || "(none)", "| session keys:", Object.keys(sessionArea).sort().join(",") || "(none)");

  if (JSON.stringify(local).includes(process.env.E2E_PASSWORD)) fail("the password is in chrome.storage.local");
  if (JSON.stringify(sessionArea).includes(process.env.E2E_PASSWORD)) fail("the password is in chrome.storage.session");
  if ("token" in local) fail("the token is in chrome.storage.local — it belongs in session, which never reaches disk");
  if (!sessionArea.token) fail("no token in chrome.storage.session after signing in");
  // A personal access token, not the 24h JWT: revocable from the server and listed as a device.
  if (!String(sessionArea.token).startsWith("togo_pat_")) {
    fail(`the stored token is not a PAT (${String(sessionArea.token).slice(0, 12)}…) — sign-in fell back to the JWT`);
  }
  log("credential: PAT in session only, nothing authenticating on disk");

  // Selected by accessible name, not a class. `.mgy-btn-stop` vanished when the timer moved to
  // shadcn Buttons and this test sat broken until someone ran it; a styling change should not be
  // able to do that again. The tray e2e was fixed the same way.
  const stopBtn = page.locator(".mgy-timer").getByRole("button", { name: /Stop/i });
  if (await stopBtn.isVisible()) await stopBtn.click();
  await page.locator(".mgy-timer-idle input").fill("Extension e2e");
  await page.locator(".mgy-timer-idle").getByRole("button", { name: /Start/ }).click();
  await page.locator(".mgy-timer-running").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1000);
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  log("timer running; badge =", JSON.stringify(badge));
  await page.screenshot({ path: "e2e-shots/ext-running.png" });
  await stopBtn.click();
  await page.locator(".mgy-timer-idle").waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  log("stopped; badge =", JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))));

  // context-menu hand-off: what the menu click stores, then the popup's page card
  await sw.evaluate(() => chrome.storage.session.set({ pending: { url: "https://example.com/pricing", title: "Pricing — Example", mode: "issue" } }));
  await page.reload();
  await page.getByText("This page").waitFor({ timeout: 10000 });
  await page.screenshot({ path: "e2e-shots/ext-page.png" });
  await page.locator(".mgy-page").getByRole("button", { name: "File an issue" }).last().click();
  // The key prefix comes from the workspace, so matching a specific one ties this test to whichever
  // workspace it was first written against.
  await page.getByText(/Issue filed: [A-Z]+-\d+/).waitFor({ timeout: 10000 });
  log("filed:", await page.locator(".mgy-ok").innerText());
  if (failures.length) {
    console.error(`[ext-e2e] FAIL — ${failures.length} check(s):\n  ` + failures.join("\n  "));
    process.exitCode = 1;
  } else {
    log("PASS");
  }
} catch (e) {
  console.error("[ext-e2e] FAIL", e);
  process.exitCode = 1;
} finally {
  await ctx.close();
}
