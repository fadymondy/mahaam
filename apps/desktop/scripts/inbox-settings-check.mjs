// Drives the built app through the inbox and settings on a fresh profile against a LOCAL stack:
// the list and its keys, opening an issue, mark all read; theme and language switching the whole
// app, the notifications pref, editing the profile name (checked on the server) and the devices
// list with a revoke. Window-only screenshots in en/ar × light/dark go to e2e-shots/.
//
//   E2E_EMAIL=… E2E_PASSWORD=… MAHAAM_API_URL=http://127.0.0.1:3020 node scripts/inbox-settings-check.mjs
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = process.env.MAHAAM_API_URL ?? "http://127.0.0.1:3020";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("set E2E_EMAIL and E2E_PASSWORD");

const { ELECTRON_RUN_AS_NODE: _d, ...env } = process.env;
mkdirSync("e2e-shots", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...env, MAHAAM_E2E: "1", MAHAAM_API_URL: API, MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-desktop-")) },
});
const shot = async (name) => {
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).getMediaSourceId().split(":")[1]);
  await new Promise((r) => setTimeout(r, 450));
  execFileSync("screencapture", ["-x", "-o", "-l", id, `e2e-shots/${name}.png`]);
  console.log("shot", name);
};
const failures = [];
const check = (ok, what) => {
  console.log(ok ? "  ok  " : "  FAIL", what);
  if (!ok) failures.push(what);
};

await app.firstWindow();
// The main window (the popover and other surfaces are windows too).
let page;
for (let i = 0; i < 40 && !page; i++) {
  page = app.windows().find((w) => w.url().includes("surface=main"));
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.waitForLoadState("load");
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).setSize(1280, 820));

// Helpers: the main process's own channels, as the renderer uses them.
const cmd = (c) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).webContents.send("command", c), c);
const invoke = (channel, ...args) => page.evaluate(([ch, a]) => window.mahaam.invoke(ch, ...a), [channel, args]);
const call = async (method, ...args) => {
  const out = await invoke("api", method, args);
  if (!out.ok) throw new Error(`${method}: ${out.status} ${out.message}`);
  return out.value;
};
const prefs = async (patch) => (await invoke("app:prefs", patch)).value;
const html = () => page.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), dir: document.documentElement.dir }));

await page.locator("#email").waitFor({ timeout: 15000 });
await page.locator("#email").fill(EMAIL);
await page.locator("#password").fill(PASSWORD);
await page.locator("[data-signin-form] button[type=submit]").click();
await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
await prefs({ theme: "light", locale: "en" });

// ── Inbox ─────────────────────────────────────────────────────────────────────
console.log("inbox");
await cmd({ type: "navigate", to: { name: "inbox" } });
const rows = page.locator("[data-inbox-list] [role=option]");
await rows.first().waitFor({ timeout: 10000 });
const before = await call("notifications", 50);
check((await rows.count()) === before.notifications.length, `list shows every notification (${before.notifications.length})`);
check((await page.locator("[data-inbox-list] [role=group]").count()) >= 1, "grouped by day");
await page.waitForTimeout(600);
await shot("inbox-1-en-light-list");

await page.keyboard.press("j");
await page.locator("[data-inbox-preview]").waitFor();
const first = before.notifications[0];
check((await rows.first().getAttribute("aria-selected")) === "true", "j selects the first");
await page.locator("[data-issue-title], [data-inbox-preview=note]").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const afterSelect = await call("notifications", 50);
check(!first.read_at ? !!afterSelect.notifications.find((n) => n.id === first.id)?.read_at : true, "selecting marks it read on the server");
await shot("inbox-2-en-light-preview");

await page.keyboard.press("j");
check((await rows.nth(1).getAttribute("aria-selected")) === "true", "j moves down");
await page.keyboard.press("k");
check((await rows.first().getAttribute("aria-selected")) === "true", "k moves up");

// An issue with a markdown description, for the preview's typography.
const withBody = rows.filter({ hasText: "Hero section loses contrast" }).first();
if (await withBody.count()) {
  await withBody.click();
  await page.locator("[data-issue-title]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await shot("inbox-2b-en-light-markdown");
}

for (const [locale, theme] of [["en", "dark"], ["ar", "light"], ["ar", "dark"]]) {
  await prefs({ locale, theme });
  await page.waitForTimeout(700);
  const h = await html();
  check(h.dark === (theme === "dark") && h.dir === (locale === "ar" ? "rtl" : "ltr"), `app follows ${locale}/${theme}`);
  await shot(`inbox-3-${locale}-${theme}-preview`);
}
await prefs({ locale: "en", theme: "light" });
await page.waitForTimeout(400);

// Enter opens the linked issue; ⌘[ comes back.
const key = await page.locator("[data-inbox-preview]").getAttribute("data-inbox-preview");
await page.keyboard.press("Enter");
await page.locator("main[data-route=issue]").waitFor({ timeout: 5000 }).then(
  () => check(true, `Enter opens ${key}`),
  () => check(false, `Enter opens ${key}`),
);
await page.keyboard.press("Meta+BracketLeft");
await page.locator("main[data-route=inbox]").waitFor({ timeout: 5000 });

// Unread filter, then mark all read.
await page.locator("[data-filter=unread]").click();
await page.waitForTimeout(300);
const unreadShown = await rows.count();
check(unreadShown <= before.notifications.length, `unread filter (${unreadShown} shown)`);
await shot("inbox-4-en-light-unread");
await page.locator("[data-filter=all]").click();
const unreadNow = (await call("notifications", 50)).unread;
if (unreadNow > 0) {
  await page.locator("[data-mark-all]").click();
  await page.waitForTimeout(800);
  check((await call("notifications", 50)).unread === 0, "mark all read → 0 unread on the server");
  check((await page.locator("[data-inbox-list] [data-unread]").count()) === 0, "no unread dots left");
  check((await page.locator("aside [data-unread]").count()) === 0, "sidebar badge cleared");
} else check(true, "nothing left to mark read");
await shot("inbox-5-en-light-all-read");

// ── Settings ──────────────────────────────────────────────────────────────────
console.log("settings");
await cmd({ type: "settings" });
await page.locator("[data-settings=general]").waitFor();
await page.waitForTimeout(400);
await shot("settings-1-general-en-light");

await page.locator("[data-theme-tile=dark]").click();
await page.waitForTimeout(500);
check((await html()).dark, "Dark tile → the app is dark");
check((await invoke("app:config")).value.prefs.theme === "dark", "theme pref saved in main");
await shot("settings-2-general-en-dark");
await page.locator("[data-row=language] [data-value=ar]").click();
await page.waitForTimeout(600);
check((await html()).dir === "rtl", "العربية → the app is RTL");
check((await page.locator("aside[data-sidebar]").innerText()).includes("الوارد"), "the sidebar follows the language");
await shot("settings-3-general-ar-dark");
await page.locator("[data-theme-tile=light]").click();
await page.waitForTimeout(500);
await shot("settings-4-general-ar-light");
await page.locator("[data-row=language] [data-value=en]").click();
await page.waitForTimeout(400);

const notifyBefore = (await invoke("app:config")).value.prefs.notify;
await page.locator("[data-pref=notify]").click();
await page.waitForTimeout(300);
check((await invoke("app:config")).value.prefs.notify === !notifyBefore, "notifications switch flips the pref");
await page.locator("[data-pref=notify]").click();
await page.waitForTimeout(300);
check((await invoke("app:config")).value.prefs.notify === notifyBefore, "and back");

// Account: edit the name, see it on the server.
await page.locator("[data-settings-nav=account]").click();
const nameInput = page.locator("[data-profile-name]");
await nameInput.waitFor({ timeout: 10000 }).catch(async (e) => {
  await shot("settings-account-FAILED");
  console.log(await page.locator("main").innerText());
  throw e;
});
const originalName = (await call("profile")).name;
const newName = `QA Tester ${new Date().toISOString().slice(11, 16)}`;
await nameInput.fill(newName);
await nameInput.press("Enter");
await page.waitForTimeout(1200);
check((await call("profile")).name === newName, `profile name saved on the server ("${newName}")`);
check((await page.locator("[data-profile-display]").innerText()).trim() === newName, "the header shows the new name");
await page.locator("[data-row=device]").first().waitFor({ timeout: 10000 });
if (await page.locator("[data-devices-toggle]").count()) await page.locator("[data-devices-toggle]").click();
const devices = await call("devices");
check(devices.some((d) => d.current), "this device is in the list and marked");
check((await page.locator("[data-row=device]").count()) === devices.length, `devices listed (${devices.length})`);
await shot("settings-5-account-en-light");

// Revoke: a throwaway token made for this check, never someone's real device.
const login = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: "togo_csrf=x", "X-CSRF-Token": "x" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
const made = await fetch(`${API}/api/auth/tokens`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}`, Cookie: "togo_csrf=x", "X-CSRF-Token": "x" },
  body: JSON.stringify({ name: "Check device (throwaway)" }),
}).then((r) => r.json());
const throwaway = (await call("devices")).find((d) => d.name === "Check device (throwaway)");
check(!!throwaway && !!made.token, "throwaway device minted");
if (throwaway) {
  await page.locator("[data-settings-nav=general]").click();
  await page.locator("[data-settings-nav=account]").click();
  if (await page.locator("[data-devices-toggle]").count()) await page.locator("[data-devices-toggle]").click();
  await page.locator(`[data-revoke="${throwaway.id}"]`).click();
  await page.locator("[data-revoke-dialog]").waitFor();
  await shot("settings-6-revoke-confirm");
  await page.locator("[data-confirm-revoke]").click();
  await page.waitForTimeout(1000);
  check(!(await call("devices")).some((d) => d.id === throwaway.id), "revoked on the server");
}

await prefs({ theme: "dark" });
await page.waitForTimeout(400);
await shot("settings-7-account-en-dark");
await page.locator("[data-timezone]").click();
await page.keyboard.type("Cairo");
await page.waitForTimeout(400);
await shot("settings-7b-timezone-menu");
// The picker's filter field keeps Escape to itself (components/pickers.tsx), so close it by
// clicking outside, as a person would.
await page.mouse.click(1000, 120);
await page.locator("[data-base-ui-inert]").waitFor({ state: "detached", timeout: 3000 }).catch(() => null);
await prefs({ theme: "light", locale: "ar" });
await page.waitForTimeout(500);
await shot("settings-8-account-ar-light");
await prefs({ locale: "en" });

for (const s of ["workspaces", "shortcuts", "about"]) {
  await page.locator(`[data-settings-nav=${s}]`).click();
  await page.locator(`[data-settings-section=${s}]`).waitFor();
  await page.waitForTimeout(300);
  await shot(`settings-9-${s}-en-light`);
}
await prefs({ theme: "dark", locale: "ar" });
await page.waitForTimeout(500);
await shot("settings-10-about-ar-dark");
await page.locator("[data-settings-nav=shortcuts]").click();
await page.waitForTimeout(300);
await shot("settings-11-shortcuts-ar-dark");
await prefs({ theme: "light", locale: "en" });

await call("updateProfile", { name: originalName }); // leave the shared account as it was
// Sign out: the device's token is revoked on the server, not left behind by every run.
await page.locator("[data-settings-nav=account]").click();
const mine = (await call("devices")).find((d) => d.current);
await page.locator("[data-sign-out]").click();
await page.locator("#email").waitFor({ timeout: 10000 });
const left = await fetch(`${API}/api/auth/tokens`, { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json());
check(!left.some((t) => t.id === mine?.id), "sign out revokes this device's token");

// Switching workspaces, as a second account that belongs to two (optional).
if (process.env.E2E_EMAIL2) {
  console.log("workspaces");
  await page.locator("#email").fill(process.env.E2E_EMAIL2);
  await page.locator("#password").fill(process.env.E2E_PASSWORD2 ?? PASSWORD);
  await page.locator("[data-signin-form] button[type=submit]").click();
  await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
  await cmd({ type: "settings", section: "workspaces" });
  await page.locator("[data-settings-section=workspaces]").waitFor();
  const switchers = page.locator("[data-switch]");
  check((await switchers.count()) >= 1, "another workspace to switch to");
  const from = (await invoke("session:get")).value.workspace.slug;
  const target = await switchers.first().getAttribute("data-switch");
  await switchers.first().click();
  await page.waitForTimeout(1200);
  const to = (await invoke("session:get")).value.workspace.slug;
  check(to === target && to !== from, `switched ${from} → ${to}`);
  await shot("settings-12-workspaces-switched");
  // A fresh workspace has an empty inbox: inbox zero.
  await cmd({ type: "navigate", to: { name: "inbox" } });
  await page.locator("[data-inbox=zero]").waitFor({ timeout: 10000 }).then(
    () => check(true, "inbox zero in an empty workspace"),
    () => check(false, "inbox zero in an empty workspace"),
  );
  await shot("inbox-6-zero-en-light");
  await prefs({ theme: "dark", locale: "ar" });
  await page.waitForTimeout(500);
  await shot("inbox-7-zero-ar-dark");
  await prefs({ theme: "light", locale: "en" });
  await cmd({ type: "settings", section: "workspaces" });
  await page.locator(`[data-switch="${from}"]`).click();
  await page.waitForTimeout(1000);
  check((await invoke("session:get")).value.workspace.slug === from, "and back");
  await page.locator("[data-settings-nav=account]").click();
  await page.locator("[data-sign-out]").click();
  await page.locator("#email").waitFor({ timeout: 10000 });
}

console.log("page errors:", errors);
if (errors.length) failures.push("page errors");
await app.close();
if (failures.length) {
  console.log("FAILED:", failures);
  process.exit(1);
}
console.log("all checks passed");
