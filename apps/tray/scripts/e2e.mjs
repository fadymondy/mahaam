// Drives the built tray app against a running API: sign in → pick workspace → start a timer on a
// Next-up task → a timer started elsewhere (plain API call) arrives over SSE → stop.
//   MAHAAM_API_URL=http://localhost:8120 E2E_EMAIL=... E2E_PASSWORD=... node scripts/e2e.mjs
// Needs `npm run build` first. Screenshots land in e2e-shots/.
import { _electron as electron } from "playwright-core";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = process.env.MAHAAM_API_URL ?? "http://localhost:8120";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WS = process.env.E2E_WORKSPACE ?? "tray-dev";
if (!EMAIL || !PASSWORD) throw new Error("set E2E_EMAIL and E2E_PASSWORD");
mkdirSync("e2e-shots", { recursive: true });
// A parent that is itself Electron (an IDE, an agent host) may export ELECTRON_RUN_AS_NODE, which
// would start the app as plain Node.
const { ELECTRON_RUN_AS_NODE: _drop, ...cleanEnv } = process.env;

const app = await electron.launch({
  args: ["."],
  env: { ...cleanEnv, MAHAAM_TRAY_SHOW: "1", MAHAAM_API_URL: API, MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-tray-")) },
});
const log = (...a) => console.log("[e2e]", ...a);
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("load");
  const prefs = await page.evaluate(() => ({ csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"), node: typeof globalThis.require, bridge: Object.keys(window.mahaam ?? {}) }));
  log("renderer: require =", prefs.node, "| bridge =", prefs.bridge.join(","), "| CSP =", prefs.csp?.slice(0, 40) + "…");

  // sign in (server field is prefilled from MAHAAM_API_URL)
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.screenshot({ path: "e2e-shots/1-signin.png" });
  await page.getByRole("button", { name: "Sign in" }).click();

  // workspace picker (auto-picks when there is only one)
  const wsBtn = page.getByRole("button", { name: new RegExp(WS) });
  await Promise.race([page.getByText("Next up").waitFor({ timeout: 15000 }), wsBtn.first().click({ timeout: 15000 })]).catch(() => null);
  await page.getByText("Next up").waitFor({ timeout: 15000 });
  log("signed in; home visible");

  // make sure nothing runs, then start on the first task
  // Selected by accessible name, not a class. The stop button is a shadcn <Button> now, and
  // the old .mgy-btn-stop hook vanished with the migration — a styling change should not be able
  // to break this test again.
  const stopBtn = page.locator(".mgy-timer").getByRole("button", { name: /Stop/i });
  if (await stopBtn.isVisible()) await stopBtn.click();
  await page.locator(".mgy-timer-idle input").waitFor();
  const first = page.locator(".mgy-list .mgy-row").first();
  const firstTitle = (await first.locator(".mgy-title").innerText()).trim();
  await first.getByRole("button", { name: /Start/ }).click();
  await page.locator(".mgy-timer-running").waitFor({ timeout: 10000 });
  log("started timer on:", firstTitle);
  await page.waitForTimeout(2200);
  const clock1 = await page.locator(".mgy-timer-running .mgy-clock").innerText();
  const tooltip = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  log("clock after ~2s:", clock1, "| windows:", tooltip);
  await page.screenshot({ path: "e2e-shots/2-running.png" });

  // stop from the popover
  await stopBtn.click();
  await page.locator(".mgy-timer-idle").waitFor({ timeout: 10000 });
  log("stopped from the popover");

  // realtime: start a timer through the API directly (as the web app would) and wait for SSE
  const tok = await (async () => {
    const v = "e2e" + Date.now();
    const r = await fetch(API + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `togo_csrf=${v}`, "X-CSRF-Token": v, "X-Forwarded-For": "10.9.9.2" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    return (await r.json()).token;
  })();
  const H = { Authorization: `Bearer ${tok}`, "X-Workspace-ID": WS, "Content-Type": "application/json" };
  await fetch(API + "/api/w/time/start", { method: "POST", headers: H, body: JSON.stringify({ description: "Started on the web (e2e)" }) });
  await page.locator(".mgy-timer-running").waitFor({ timeout: 10000 });
  log("SSE: timer started elsewhere appeared in the tray:", await page.locator(".mgy-timer-running .mgy-title").innerText());
  await fetch(API + "/api/w/time/stop", { method: "POST", headers: H, body: "{}" });
  await page.locator(".mgy-timer-idle").waitFor({ timeout: 10000 });
  log("SSE: stop elsewhere cleared the tray timer");

  // Arabic + dark
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "العربية" }).click();
  await page.getByRole("button", { name: "داكن" }).click();
  await page.getByRole("button", { name: /رجوع/ }).click();
  await page.waitForTimeout(300);
  const dir = await page.evaluate(() => [document.documentElement.dir, document.documentElement.className]);
  log("ar/dark:", dir.join(" "));
  await page.screenshot({ path: "e2e-shots/3-ar-dark.png" });
  await page.getByRole("button", { name: "الإعدادات" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Light" }).click();
  await page.getByRole("button", { name: /Back/ }).click();
  log("PASS");
} catch (e) {
  console.error("[e2e] FAIL", e);
  process.exitCode = 1;
} finally {
  await app.close();
}
