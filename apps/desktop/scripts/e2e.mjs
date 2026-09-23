// Drives the built desktop app against a running console + API:
//   sign in → the workspace in the native window (chrome checks, en/ar × light/dark screenshots)
//   → a timer started on "another device" (a plain API call) reaches the menu bar live
//   → stop from the menu bar → close hides the window and the menu-bar timer keeps running.
//
//   MAHAAM_URL=http://127.0.0.1:3020 MAHAAM_API_URL=http://127.0.0.1:8120 \
//   E2E_EMAIL=... E2E_PASSWORD=... E2E_WORKSPACE=qa-studio node scripts/e2e.mjs
//
// Needs `npm run build` first. Screenshots land in e2e-shots/.
import { _electron as electron } from "playwright-core";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const URL_ = process.env.MAHAAM_URL ?? "http://127.0.0.1:3020";
const API = process.env.MAHAAM_API_URL ?? "http://127.0.0.1:8120";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WS = process.env.E2E_WORKSPACE ?? "qa-studio";
if (!EMAIL || !PASSWORD) throw new Error("set E2E_EMAIL and E2E_PASSWORD");
mkdirSync("e2e-shots", { recursive: true });
// A parent that is itself Electron (an IDE, an agent host) may export ELECTRON_RUN_AS_NODE.
const { ELECTRON_RUN_AS_NODE: _drop, ...cleanEnv } = process.env;

const log = (...a) => console.log("[e2e]", ...a);
const fail = (msg) => {
  throw new Error(msg);
};
const until = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

// "Another device": a bearer session straight against the API, like the phone or the extension.
const other = await (async () => {
  const v = "e2e" + Date.now();
  const r = await fetch(API + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `togo_csrf=${v}`, "X-CSRF-Token": v, "X-Forwarded-For": "10.9.9.3" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tok = (await r.json()).token ?? fail(`API sign-in failed: ${r.status}`);
  const H = { Authorization: `Bearer ${tok}`, "X-Workspace-ID": WS, "Content-Type": "application/json" };
  return {
    start: (description) => fetch(API + "/api/w/time/start", { method: "POST", headers: H, body: JSON.stringify({ description }) }),
    stop: () => fetch(API + "/api/w/time/stop", { method: "POST", headers: H, body: "{}" }),
    running: async () => (await (await fetch(API + "/api/w/time/running", { headers: H })).json()).timer,
  };
})();
if (await other.running()) await other.stop();

const errors = [];
const app = await electron.launch({
  args: ["."],
  env: { ...cleanEnv, MAHAAM_E2E: "1", MAHAAM_URL: URL_, MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-desktop-")) },
});
/** The real window, title bar and traffic lights included (macOS; a page screenshot has no chrome). */
const windowShot = async (path) => {
  if (process.platform !== "darwin") return;
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1]);
  await new Promise((r) => setTimeout(r, 400));
  try {
    execFileSync("screencapture", ["-x", "-o", "-l", id, path]);
  } catch (e) {
    log("window screenshot skipped:", e.message.split("\n")[0]);
  }
};
const tray = {
  title: () => app.evaluate(() => globalThis.mahaamTray.title()),
  items: () => app.evaluate(() => globalThis.mahaamTray.items()),
  click: (label) => app.evaluate((_e, l) => globalThis.mahaamTray.click(l), label),
};

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForLoadState("load");

  // The page is sandboxed: no Node, only the bridge.
  const env = await page.evaluate(() => ({
    require: typeof globalThis.require,
    bridge: Object.keys(window.mahaamDesktop ?? {}).sort().join(","),
    desktop: document.documentElement.dataset.desktop,
  }));
  log("renderer: require =", env.require, "| bridge =", env.bridge, "| data-desktop =", env.desktop);
  if (env.require !== "undefined") fail("the page can reach Node");
  if (env.desktop !== process.platform) fail("html[data-desktop] missing on the first paint");

  await page.locator("#email").waitFor({ timeout: 20000 });
  await page.screenshot({ path: "e2e-shots/1-signin.png" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/(workspaces|w\/)/, { timeout: 20000 });
  await page.goto(`${URL_}/en/w/${WS}/projects`);
  await page.locator("[data-timer-bar]").waitFor({ timeout: 20000 });
  log("signed in; workspace shell visible");

  // Window chrome: the lights' room, the drag regions, no install-app button.
  const chrome = await page.evaluate(() => {
    const brand = document.querySelector("[data-desktop-brand]");
    const header = document.querySelector("header[data-desktop-drag]");
    const btn = header?.querySelector("button");
    const cs = (el) => (el ? getComputedStyle(el) : null);
    return {
      brandPad: cs(brand)?.paddingLeft,
      headerRegion: cs(header)?.getPropertyValue("-webkit-app-region") || cs(header)?.getPropertyValue("app-region"),
      buttonRegion: cs(btn)?.getPropertyValue("-webkit-app-region") || cs(btn)?.getPropertyValue("app-region"),
      installHidden: [...document.querySelectorAll("[data-desktop-hide]")].every((el) => cs(el).display === "none"),
    };
  });
  log("chrome:", JSON.stringify(chrome));
  if (process.platform === "darwin" && chrome.brandPad !== "92px") fail("sidebar brand row has no room for the traffic lights");
  if (chrome.headerRegion !== "drag" || chrome.buttonRegion !== "no-drag") fail("drag regions are wrong");
  if (!chrome.installHidden) fail("the install-app button shows in the desktop app");
  await page.screenshot({ path: "e2e-shots/2-projects-light-en.png" });
  await windowShot("e2e-shots/window-light-en.png");

  // Theme from the View menu reaches the page (and nativeTheme, for the traffic lights).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { type: "theme", theme: "dark" }));
  await until("dark theme", () => page.evaluate(() => document.documentElement.classList.contains("dark")));
  await until("nativeTheme dark", () => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource === "dark"));
  await page.screenshot({ path: "e2e-shots/3-projects-dark-en.png" });

  // ── the menu-bar timer ──
  log("tray idle:", JSON.stringify(await tray.items()));
  await other.start("Started on the phone (e2e)");
  const t1 = await until("the menu bar to show the phone's timer", async () => ((await tray.title()).trim() ? tray.title() : null), 8000);
  log("live: a timer started elsewhere reached the menu bar →", JSON.stringify(t1));
  await page.waitForTimeout(2200);
  const t2 = await tray.title();
  if (t2 === t1) fail(`the menu-bar clock is not ticking (${t1} → ${t2})`);
  log("ticking:", t1.trim(), "→", t2.trim());
  const items = await tray.items();
  log("tray running:", JSON.stringify(items));
  if (!items.includes("Started on the phone (e2e)")) fail("the menu does not name the running timer");
  await page.locator("[data-timer-running]").waitFor({ timeout: 5000 });
  await page.screenshot({ path: "e2e-shots/4-running-dark-en.png" });

  await tray.click("Stop Timer");
  await until("the server to stop the timer", async () => !(await other.running()));
  await until("the menu bar to clear", async () => (await tray.title()).trim() === "");
  log("stopped from the menu bar; server and menu bar agree");
  const resume = await until("a Resume entry", async () => {
    const it = await tray.items();
    return it.find((l) => l.startsWith("Started on the phone (e2e)")) ? it : null;
  });
  log("tray after stop:", JSON.stringify(resume));

  // Close hides the last window; the page keeps the menu bar live.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(500);
  const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
  if (hidden.length !== 1 || hidden[0]) fail(`close should hide the window, got ${JSON.stringify(hidden)}`);
  await other.start("Started while hidden (e2e)");
  const t3 = await until("the hidden window to keep the menu bar live", async () => ((await tray.title()).trim() ? tray.title() : null), 8000);
  log("window hidden, timer started elsewhere still reached the menu bar →", JSON.stringify(t3));
  await other.stop();
  await until("the menu bar to clear while hidden", async () => (await tray.title()).trim() === "");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());

  // Arabic: the page goes RTL, the lights move to the header's end.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { type: "locale", locale: "ar" }));
  await page.waitForURL(/\/ar\//, { timeout: 15000 });
  await page.locator("[data-timer-bar]").waitFor({ timeout: 20000 });
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    headerPad: getComputedStyle(document.querySelector("header[data-desktop-drag]")).paddingLeft,
  }));
  log("ar:", JSON.stringify(rtl), "| tray:", JSON.stringify(await tray.items()));
  if (rtl.dir !== "rtl") fail("Arabic is not RTL");
  if (process.platform === "darwin" && rtl.headerPad !== "92px") fail("RTL header has no room for the traffic lights");
  await page.screenshot({ path: "e2e-shots/5-projects-dark-ar.png" });
  await windowShot("e2e-shots/window-dark-ar.png");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { type: "theme", theme: "light" }));
  await until("light theme", () => page.evaluate(() => !document.documentElement.classList.contains("dark")));
  await page.screenshot({ path: "e2e-shots/6-projects-light-ar.png" });

  // Collapsed sidebar (LTR): the rail steps aside for the lights.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { type: "locale", locale: "en" }));
  await page.waitForURL(/\/en\//, { timeout: 15000 });
  await page.locator("[data-timer-bar]").waitFor({ timeout: 20000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { type: "toggle-nav" }));
  await until("collapsed nav", () => page.evaluate(() => document.querySelector(".grid-shell")?.getAttribute("data-nav") === "collapsed"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e-shots/7-collapsed-light-en.png" });
  await windowShot("e2e-shots/window-collapsed-en.png");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("desktop:command", { type: "toggle-nav" }));

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  log("PASS");
} finally {
  await other.stop().catch(() => {});
  await app.close().catch(() => {});
}
