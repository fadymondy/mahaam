// The desktop app's services, end to end, against a running stack:
//   the sandbox and the IPC allowlist → password sign-in (a device token in the keychain) →
//   a timer started on "another device" reaches the menu bar live and ticks, and the sidebar →
//   Stop from the menu bar stops it on the server → closing hides the window and the menu bar stays
//   live → a mahaam:// link opens the issue → Arabic switches the app and the menu bar →
//   relaunch resumes the session without a password → sign out ends it.
//
//   MAHAAM_API_URL=http://127.0.0.1:3020 E2E_EMAIL=... E2E_PASSWORD=... node scripts/e2e.mjs
// Needs `npm run build`. Window screenshots land in e2e-shots/ (macOS).
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = process.env.MAHAAM_API_URL ?? "http://127.0.0.1:3020";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WS = process.env.E2E_WORKSPACE ?? "qa-studio";
if (!EMAIL || !PASSWORD) throw new Error("set E2E_EMAIL and E2E_PASSWORD");
mkdirSync("e2e-shots", { recursive: true });
const { ELECTRON_RUN_AS_NODE: _drop, ...cleanEnv } = process.env;
const profile = mkdtempSync(join(tmpdir(), "mahaam-desktop-"));

const log = (...a) => console.log("[e2e]", ...a);
const fail = (m) => {
  throw new Error(m);
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
    headers: { "Content-Type": "application/json", Cookie: `togo_csrf=${v}`, "X-CSRF-Token": v, "X-Forwarded-For": "10.9.9.4" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tok = (await r.json()).token ?? fail(`API sign-in failed: ${r.status}`);
  const H = { Authorization: `Bearer ${tok}`, "X-Workspace-ID": WS, "Content-Type": "application/json" };
  return {
    start: (description) => fetch(API + "/api/w/time/start", { method: "POST", headers: H, body: JSON.stringify({ description }) }),
    stop: () => fetch(API + "/api/w/time/stop", { method: "POST", headers: H, body: "{}" }),
    running: async () => (await (await fetch(API + "/api/w/time/running", { headers: H })).json()).timer,
    tokens: async () => (await (await fetch(API + "/api/auth/tokens", { headers: H })).json()) ?? [],
  };
})();

async function launch() {
  const app = await electron.launch({
    args: ["."],
    env: { ...cleanEnv, MAHAAM_E2E: "1", MAHAAM_API_URL: API, MAHAAM_USER_DATA: profile },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.waitForLoadState("load");
  const tray = {
    title: () => app.evaluate(() => globalThis.mahaamTray.title()),
    items: () => app.evaluate(() => globalThis.mahaamTray.items()),
    click: (label) => app.evaluate((_e, l) => globalThis.mahaamTray.click(l), label),
  };
  const shot = async (path) => {
    if (process.platform !== "darwin") return;
    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1]);
    await new Promise((r) => setTimeout(r, 500));
    try {
      execFileSync("screencapture", ["-x", "-o", "-l", id, path]);
    } catch (e) {
      log("window screenshot skipped:", String(e.message).split("\n")[0]);
    }
  };
  const command = (c) => app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0].webContents.send("command", cmd), c);
  return { app, page, errors, tray, shot, command };
}

const mine = (list) => (Array.isArray(list) ? list : []).filter((t) => String(t.name).startsWith("Mahaam for "));

let run = await launch();
try {
  let { app, page, tray, shot, command } = run;

  // ── the sandbox ──
  const env = await page.evaluate(async () => {
    let blocked = false;
    try {
      await window.mahaam.invoke("shell:open", "x");
    } catch {
      blocked = true;
    }
    return { require: typeof globalThis.require, process: typeof globalThis.process, blocked };
  });
  log("renderer:", JSON.stringify(env));
  if (env.require !== "undefined" || env.process !== "undefined") fail("the renderer can reach Node");
  if (!env.blocked) fail("an unlisted IPC channel went through");

  // ── sign in ──
  const before = mine(await other.tokens()).length;
  await page.locator("#email").waitFor({ timeout: 15000 });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("[data-signin-form] button[type=submit]").click();
  await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
  log("signed in with a password; the shell is up");
  const probe = await page.evaluate(async () => {
    const r = await window.mahaam.invoke("api", "constructor", []);
    const s = await window.mahaam.invoke("session:get");
    const text = JSON.stringify(s);
    return { unknownMethod: r.ok === false, leaksToken: /togo_pat_|eyJ[\w-]+\./.test(text) };
  });
  log("ipc:", JSON.stringify(probe));
  if (!probe.unknownMethod) fail("the API bridge ran a method that is not in the allowlist");
  if (probe.leaksToken) fail("the session handed to the renderer contains the token");
  const devices = mine(await other.tokens());
  log("device tokens on the server:", devices.map((t) => t.name).join(" | ") || "(none)");
  if (!devices.length) fail("no device token was minted for this computer");
  await shot("e2e-shots/e2e-1-shell.png");

  // ── the menu-bar timer, live ──
  if (await other.running()) await other.stop();
  await until("an idle menu bar", async () => (await tray.title()).trim() === "");
  await other.start("Started on the phone (desktop e2e)");
  const t1 = await until("the phone's timer in the menu bar", async () => ((await tray.title()).trim() ? tray.title() : null), 8000);
  await page.waitForTimeout(2200);
  const t2 = await tray.title();
  if (t1 === t2) fail(`the menu-bar clock is not ticking (${t1} → ${t2})`);
  log("live: menu bar", t1.trim(), "→", t2.trim());
  if (!(await tray.items()).includes("Started on the phone (desktop e2e)")) fail("the menu does not name the running timer");
  await page.locator("[data-timer-running]").waitFor({ timeout: 5000 });
  log("live: the sidebar shows it too");
  await shot("e2e-shots/e2e-2-running.png");

  await tray.click("Stop Timer");
  await until("the server to stop it", async () => !(await other.running()));
  await until("the menu bar to clear", async () => (await tray.title()).trim() === "");
  await until("Resume to offer it", async () => (await tray.items()).some((l) => l.startsWith("Started on the phone (desktop e2e)")));
  log("stopped from the menu bar; server, menu bar and Resume agree");

  // ── closing hides; the services keep running ──
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(400);
  const vis = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
  if (vis.length !== 1 || vis[0]) fail(`close should hide the window: ${JSON.stringify(vis)}`);
  await other.start("Started while the window is hidden");
  await until("the menu bar to update with no window", async () => (await tray.title()).trim() !== "", 8000);
  await other.stop();
  await until("the menu bar to clear with no window", async () => (await tray.title()).trim() === "", 8000);
  log("window hidden: the menu bar stayed live");

  // ── a mahaam:// link opens the issue (and shows the window) ──
  await app.evaluate(({ app: a }) => a.emit("open-url", { preventDefault() {} }, "mahaam://issue/MH-1"));
  await until("the issue route", () => page.evaluate(() => document.querySelector("main")?.getAttribute("data-route") === "issue"));
  if (!(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))) fail("the deep link did not bring the window back");
  log("mahaam://issue/MH-1 → the issue view, window shown");

  // ── Arabic, dark ──
  await command({ type: "navigate", to: { name: "my-issues" } });
  await page.evaluate(() => window.mahaam.invoke("app:prefs", { locale: "ar" }));
  await until("RTL", () => page.evaluate(() => document.documentElement.dir === "rtl"));
  const trayAr = await tray.items();
  log("ar tray:", JSON.stringify(trayAr.slice(0, 2)));
  if (!trayAr.includes("لا يوجد مؤقّت يعمل")) fail("the menu bar did not switch to Arabic");
  await shot("e2e-shots/e2e-3-ar.png");
  await page.evaluate(() => window.mahaam.invoke("app:prefs", { locale: "en", theme: "dark" }));
  await until("dark", () => page.evaluate(() => document.documentElement.classList.contains("dark")));
  await shot("e2e-shots/e2e-4-dark.png");
  await page.evaluate(() => window.mahaam.invoke("app:prefs", { theme: "system" }));

  if (run.errors.length) fail(`page errors:\n${run.errors.join("\n")}`);
  await app.close();

  // ── relaunch: the session resumes from the keychain ──
  run = await launch();
  ({ app, page } = run);
  await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
  log("relaunched: signed in from the keychain, no password asked");

  // ── sign out revokes this device's token ──
  await page.evaluate(() => window.mahaam.invoke("session:signOut"));
  await page.locator("#email").waitFor({ timeout: 10000 });
  const after = mine(await other.tokens()).length;
  log(`signed out; device tokens before sign-in ${before}, after sign-out ${after}`);
  if (after > before) fail("sign-out did not revoke this device's token");
  if (run.errors.length) fail(`page errors:\n${run.errors.join("\n")}`);
  log("PASS");
} finally {
  await other.stop().catch(() => {});
  await run.app.close().catch(() => {});
}
