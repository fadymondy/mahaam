// Drives the Time view of the built app against a running API, checking the server after each step:
//   start from the composer → the clock ticks → rename it inline → stop
//   → log a manual entry (it lands in the grid and the list) → edit its description and times
//   → delete it from the keyboard → previous week and back → the timer palette's Recent group.
// Window-only screenshots in en/ar × light/dark land in e2e-shots/time-*.png.
//
//   MAHAAM_API_URL=http://127.0.0.1:3020 E2E_EMAIL=... E2E_PASSWORD=... node scripts/time-check.mjs
//
// Other sessions may use the same account at the same time (and start or stop its timer), so the
// checks look for this run's own entries by id and description, never "the only one".
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EMAIL = process.env.E2E_EMAIL ?? "qa@mahaam.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "Qa-Test-2026!";
const WS_NAME = process.env.E2E_WORKSPACE_NAME ?? "QA Studio";
const RUN = Date.now().toString(36);
const { ELECTRON_RUN_AS_NODE: _d, ...env } = process.env;
mkdirSync("e2e-shots", { recursive: true });

const log = (...a) => console.log("[time]", ...a);
const fail = (m) => {
  throw new Error(m);
};
const until = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const app = await electron.launch({
  args: ["."],
  env: { ...env, MAHAAM_E2E: "1", MAHAAM_API_URL: process.env.MAHAAM_API_URL ?? "http://127.0.0.1:3020", MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-time-")) },
});
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
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).setSize(1280, 840));

const shot = async (name) => {
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).getMediaSourceId().split(":")[1]);
  await page.waitForTimeout(450);
  execFileSync("screencapture", ["-x", "-o", "-l", id, `e2e-shots/time-${name}.png`]);
  log("shot", name);
};
/** The server, through the app's own session (the main process's token). */
const api = (method, ...args) =>
  page.evaluate(async ([m, a]) => {
    const out = await window.mahaam.invoke("api", m, a);
    if (!out.ok) throw new Error(`${m}: ${out.status} ${out.message}`);
    return out.value;
  }, [method, args]);
const prefs = (p) => page.evaluate((x) => window.mahaam.invoke("app:prefs", x), p);
const send = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).webContents.send("command", c), cmd);

// ── sign in, pick the workspace, open Time ──
await page.waitForLoadState("load");
await page.locator("#email").waitFor({ timeout: 15000 });
await page.locator("#email").fill(EMAIL);
await page.locator("#password").fill(PASSWORD);
await page.locator("[data-signin-form] button[type=submit]").click();
await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
const ses = (await page.evaluate(() => window.mahaam.invoke("session:get"))).value;
const want = ses.workspaces.find((w) => w.name === WS_NAME);
if (want && ses.workspace?.id !== want.id) {
  await page.evaluate((id) => window.mahaam.invoke("session:selectWorkspace", id), want.id);
  await page.waitForTimeout(800);
}
log("workspace:", want?.name ?? ses.workspace?.name);
await prefs({ locale: "en", theme: "light" });
await send({ type: "navigate", to: { name: "time" } });
await page.locator("[data-time-body]").waitFor({ timeout: 15000 });
const sheet = await api("timesheet");
const tz = sheet.timezone;
const dayIn = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const timeIn = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const today = dayIn(Date.now());
log("tz", tz, "week", sheet.days[0], "→", sheet.days[6], "today", today);
await shot("1-en-light");

// ── 1. start from the composer, the clock ticks, rename inline, stop ──
const startText = `time-check timer ${RUN}`;
await page.locator("[data-time-composer-input]").fill(startText);
await page.locator("[data-time-composer-input]").press("Enter");
const runId = await until("running card", () => page.locator("[data-time-running]").getAttribute("data-time-running").catch(() => null));
let srv = await api("running");
if (srv?.id !== runId || srv.description !== startText) fail(`server running mismatch: ${JSON.stringify(srv)}`);
const c1 = await page.locator("[data-time-clock]").textContent();
await page.waitForTimeout(2200);
const c2 = await page.locator("[data-time-clock]").textContent();
if (c1 === c2) fail(`clock did not tick (${c1})`);
log("started", runId, "clock", c1, "→", c2);
const renamed = `${startText} renamed`;
await page.locator("[data-time-running-description]").fill(renamed);
await page.locator("[data-time-running-description]").press("Enter");
await until("server rename", async () => (await api("entries", { limit: 5 })).find((e) => e.id === runId)?.description === renamed);
await until("card shows rename", async () => (await page.locator("[data-time-running-description]").inputValue()) === renamed);
await shot("2-running-en-light");
await page.locator("[data-time-stop]").click();
await until("stopped on server", async () => !!(await api("entries", { limit: 10 })).find((e) => e.id === runId)?.ended_at);
await until("composer back", () => page.locator("[data-time-composer]").isVisible());
log("stopped", runId);
// Clean the stopped timer entry up (keeps the account's week tidy for the other checks).
await api("deleteEntry", runId);

// ── 2. log a manual entry (range), see it in the grid and the list ──
const ti = sheet.days.indexOf(today);
const day = ti > 0 ? sheet.days[ti - 1] : today;
const project = (await api("projects"))[0];
const desc = `time-check manual ${RUN}`;
await page.locator("body").click({ position: { x: 700, y: 20 } });
await page.keyboard.press("Escape");
await page.keyboard.press("l");
await page.locator("[data-log-time]").waitFor({ timeout: 5000 });
await page.locator("[data-log-description]").fill(desc);
if (project) {
  await page.locator("[data-log-time] [data-target-picker]").click();
  await page.locator("[data-target-menu] [cmdk-input]").fill(project.name);
  await page.locator(`[data-target-menu] [cmdk-item][data-value="p:${project.id}"]`).click();
}
await page.locator("[data-log-date]").fill(day);
await page.locator('[data-log-mode="range"]').click();
let logged = null;
for (let attempt = 0; attempt < 6 && !logged; attempt++) {
  const h = ti > 0 ? 1 + ((attempt * 3 + Number(RUN.slice(-1).charCodeAt(0))) % 20) : Math.min(attempt, 3);
  const m = (attempt * 17 + 7) % 50;
  const s = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const e = `${String(h).padStart(2, "0")}:${String(m + 8).padStart(2, "0")}`;
  await page.locator("[data-log-start]").fill(s);
  await page.locator("[data-log-end]").fill(e);
  if (attempt === 0) await shot("3-log-en-light");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  const outcome = await until("log result", async () => ((await page.locator("[data-log-time]").count()) === 0 ? "ok" : (await page.locator("[data-log-error]").count()) ? "error" : null));
  if (outcome === "ok") logged = { s, e };
  else log("log refused:", await page.locator("[data-log-error]").textContent(), "— trying another slot");
}
if (!logged) fail("could not log a manual entry");
const mine = await until("manual entry on server", async () => (await api("entries", { from: day, to: day })).find((x) => x.description === desc));
if (timeIn(mine.started_at) !== logged.s || timeIn(mine.ended_at) !== logged.e) fail(`logged times differ: ${timeIn(mine.started_at)}–${timeIn(mine.ended_at)} vs ${logged.s}–${logged.e}`);
if (project && mine.project_id !== project.id) fail("logged without the project");
log("logged", mine.id, day, logged.s, "–", logged.e);
await page.locator(`[data-entry="${mine.id}"]`).waitFor({ timeout: 8000 });
const rowSel = `[data-grid-row="${mine.project_id ?? ""}|${mine.task_id ?? ""}"] [data-cell="${day}"]`;
const cell = (await page.locator(rowSel).textContent())?.trim();
if (!cell || cell === "–") fail(`grid cell empty for ${day}: "${cell}"`);
log("grid cell", day, cell);

// The same slot again: the server refuses the overlap and the dialog says so (and stays open).
await page.keyboard.press("l");
await page.locator("[data-log-time]").waitFor();
await page.locator("[data-log-description]").fill(`${desc} overlap`);
await page.locator("[data-log-date]").fill(day);
await page.locator('[data-log-mode="range"]').click();
await page.locator("[data-log-start]").fill(logged.s);
await page.locator("[data-log-end]").fill(logged.e);
await page.locator("[data-log-submit]").click();
const overlap = await until("overlap error", async () => ((await page.locator("[data-log-error]").count()) ? page.locator("[data-log-error]").textContent() : null));
if (!/overlap/i.test(overlap)) fail(`expected an overlap error, got: ${overlap}`);
await shot("3b-log-overlap");
await page.keyboard.press("Escape");
await until("log closed", async () => (await page.locator("[data-log-time]").count()) === 0);
if ((await api("entries", { from: day, to: day })).some((x) => x.description === `${desc} overlap`)) fail("overlapping entry was created");
log("overlap refused:", overlap.trim());

// ── screenshots: en/ar × light/dark with data on screen ──
await shot("4-en-light");
await prefs({ theme: "dark" });
await shot("5-en-dark");
await prefs({ locale: "ar" });
await shot("6-ar-dark");
await prefs({ theme: "light" });
await shot("7-ar-light");
await page.keyboard.press("l");
await page.locator("[data-log-time]").waitFor();
await shot("8-log-ar-light");
await page.keyboard.press("Escape");
await prefs({ theme: "dark" });
await page.locator(`[data-entry="${mine.id}"]`).click();
await page.locator(`[data-entry-editor="${mine.id}"]`).waitFor();
await shot("9-edit-ar-dark");
await page.keyboard.press("Escape");
await prefs({ locale: "en", theme: "light" });

// ── 3. edit description and times in place ──
await page.locator(`[data-entry="${mine.id}"]`).click();
const ed = page.locator(`[data-entry-editor="${mine.id}"]`);
await ed.waitFor();
const newDesc = `${desc} edited`;
const [eh, em] = logged.e.split(":").map(Number);
const newStart = `${String(eh).padStart(2, "0")}:${String(em - 8 + 2).padStart(2, "0")}`; // two minutes later
const newEnd = `${String(eh).padStart(2, "0")}:${String(em + 1).padStart(2, "0")}`;
await ed.locator("[data-edit-description]").fill(newDesc);
await ed.locator("[data-edit-start]").fill(newStart);
await ed.locator("[data-edit-end]").fill(newEnd);
await shot("10-edit-en-light");
await ed.locator("[data-edit-description]").press("Enter");
const edited = await until("edit on server", async () => {
  const x = (await api("entries", { from: day, to: day })).find((y) => y.id === mine.id);
  return x && x.description === newDesc ? x : null;
});
if (timeIn(edited.started_at) !== newStart || timeIn(edited.ended_at) !== newEnd) {
  const err = (await page.locator("[data-edit-error]").count()) ? await page.locator("[data-edit-error]").textContent() : "";
  fail(`edited times differ: ${timeIn(edited.started_at)}–${timeIn(edited.ended_at)} vs ${newStart}–${newEnd} ${err}`);
}
log("edited", newDesc, newStart, "–", newEnd);
await until("row shows edit", async () => (await page.locator(`[data-entry="${mine.id}"]`).textContent())?.includes("edited"));

// ── keyboard: j/k move, Enter edits, Esc leaves, s continues ──
const focusedId = () => page.locator("[data-entry][data-focused]").getAttribute("data-entry").catch(() => null);
await page.locator(`[data-entry="${mine.id}"]`).hover();
await until("row focused", async () => (await focusedId()) === mine.id);
await page.mouse.move(5, 400); // off the list, so hover does not fight the keys
const ids = await page.locator("[data-entry]").evaluateAll((els) => els.map((e) => e.getAttribute("data-entry")));
const at = ids.indexOf(mine.id);
const dir = at < ids.length - 1 ? ["j", "k"] : ["k", "j"];
await page.keyboard.press(dir[0]);
await until("focus moved", async () => (await focusedId()) === ids[at + (dir[0] === "j" ? 1 : -1)]);
await page.keyboard.press(dir[1]);
await until("focus back", async () => (await focusedId()) === mine.id);
await page.keyboard.press("Enter");
await page.locator(`[data-entry-editor="${mine.id}"]`).waitFor({ timeout: 3000 });
await page.keyboard.press("Escape");
await page.locator(`[data-entry="${mine.id}"]`).waitFor({ timeout: 3000 });
await until("focus kept", async () => (await focusedId()) === mine.id);
await page.keyboard.press("s");
const cont = await until("continued on server", async () => {
  const r = await api("running");
  return r && r.description === newDesc && r.project_id === mine.project_id ? r : null;
});
await page.locator(`[data-time-running="${cont.id}"]`).waitFor({ timeout: 5000 });
await shot("10b-continued");
await api("stop");
await api("deleteEntry", cont.id);
log("keyboard ok; continued as", cont.id);

// ── 4. delete from the keyboard (focus → ⌫ → confirm) ──
await page.locator(`[data-entry="${mine.id}"]`).hover();
await until("row focused", async () => (await page.locator(`[data-entry="${mine.id}"]`).getAttribute("data-focused")) !== null);
await page.keyboard.press("Backspace");
await page.locator("[data-time-confirm]").waitFor({ timeout: 5000 });
await shot("11-delete-confirm");
await page.locator("[data-time-confirm-ok]").click();
await until("deleted on server", async () => !(await api("entries", { from: day, to: day })).some((x) => x.id === mine.id));
await until("row gone", async () => (await page.locator(`[data-entry="${mine.id}"]`).count()) === 0);
log("deleted", mine.id);

// ── 5. previous week and back ──
const w0 = await page.locator("[data-time-body]").getAttribute("data-week-start");
await page.locator("[data-week-prev]").click();
const prev = await until("previous week", async () => {
  const w = await page.locator("[data-time-body]").getAttribute("data-week-start");
  return w && w !== w0 && !(await page.locator("[data-time-body].opacity-60").count()) ? w : null;
});
const srvPrev = await api("timesheet", prev);
if (srvPrev.days[0] !== prev) fail(`previous week mismatch ${prev} vs ${srvPrev.days[0]}`);
await shot("12-prev-week");
await page.locator("[data-week-today]").click();
await until("back to this week", async () => (await page.locator("[data-time-body]").getAttribute("data-week-start")) === w0);
log("weeks", w0, "→", prev, "→", w0);

// ── 6. a grid cell opens Log time on that day; the palette shows Recent ──
await page.locator(`[data-grid-add] [data-cell="${sheet.days[0]}"]`).click();
await page.locator("[data-log-time]").waitFor();
const pre = await page.locator("[data-log-date]").inputValue();
if (pre !== (sheet.days[0] > today ? today : sheet.days[0])) fail(`cell preset date ${pre}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await send({ type: "timer-palette" });
await page.locator("[data-timer-palette]").waitFor();
await page.waitForTimeout(600);
const recentCount = await page.locator("[data-timer-recent] [cmdk-item]").count();
log("palette recent items:", recentCount);
await shot("13-palette");
await page.keyboard.press("Escape");

// ── dark + empty-ish views for a last look ──
await prefs({ theme: "dark" });
await shot("14-en-dark-final");
await prefs({ theme: "light" });

const real = errors.filter((e) => !/Failed to load resource/.test(e));
log("errors:", real);
await app.close();
if (real.length) process.exit(1);
log("OK");
