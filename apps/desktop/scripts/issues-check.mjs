// Drives the built app through the issues views against a running stack and checks the server
// agrees: My issues (keyboard, a status change), a project (list → board, a drag across columns),
// one issue (title, comment, checklist, timer), the 404 — then en/ar × light/dark screenshots.
//
//   MAHAAM_API_URL=http://127.0.0.1:3020 E2E_EMAIL=... E2E_PASSWORD=... node scripts/issues-check.mjs
//
// Needs `npm run build` first. Window-only screenshots land in e2e-shots/issues-*.png. Everything
// it changes on the server it puts back.
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

const log = (...a) => console.log("[issues]", ...a);
const fail = (m) => {
  throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) fail(`timed out waiting for ${what}`);
    await sleep(200);
  }
};

// ── the server, as a second client ──
const server = await (async () => {
  const v = "iss" + Date.now();
  const r = await fetch(API + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `togo_csrf=${v}`, "X-CSRF-Token": v, "X-Forwarded-For": "10.9.9.21" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tok = (await r.json()).token ?? fail(`API sign-in failed: ${r.status}`);
  const H = { Authorization: `Bearer ${tok}`, "X-Workspace-ID": WS, "Content-Type": "application/json" };
  const call = async (method, path, body) => {
    const res = await fetch(API + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) fail(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b ?? {}),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
  };
})();

const projects = (await server.get("/api/w/projects")).projects;
const project = projects.find((p) => p.tasks.todo + p.tasks.doing > 3) ?? projects[0] ?? fail("no projects");
const board0 = await server.get(`/api/w/projects/${project.id}/board`);
const statuses = [...board0.statuses].sort((a, b) => a.position - b.position);
const backlog = statuses.find((s) => s.stage === "backlog") ?? statuses[0];
const todo = statuses.find((s) => s.stage === "todo" && s.id !== backlog.id) ?? statuses[1];
log("project:", project.name, "| columns:", statuses.map((s) => s.name).join(", "));

// Labels to look at (a fresh QA workspace has none).
let labels = (await server.get("/api/w/labels")).labels ?? [];
const madeLabels = [];
if (labels.length < 2) {
  for (const [name, color] of [
    ["Bug", "red"],
    ["Frontend", "blue"],
  ]) {
    if (!labels.some((l) => l.name === name)) madeLabels.push(await server.post("/api/w/labels", { name, color }));
  }
  labels = (await server.get("/api/w/labels")).labels;
}
const restore = []; // closures that put the server back

// Dress two issues with labels and a due date so rows and cards show them; undone at the end.
for (const [i, x] of board0.tasks.filter((t) => t.status_id !== backlog.id).slice(0, 2).entries()) {
  const due = new Date(Date.now() + (i ? 1 : 9) * 86400_000).toISOString().slice(0, 10);
  await server.put(`/api/w/tasks/${x.key}/labels`, { label_ids: labels.slice(0, i + 1).map((l) => l.id) });
  await server.patch(`/api/w/tasks/${x.key}`, { due_at: due });
  restore.push(() => server.put(`/api/w/tasks/${x.key}/labels`, { label_ids: x.label_ids ?? [] }));
  restore.push(() => server.patch(`/api/w/tasks/${x.key}`, { due_at: x.due_at ?? "" }));
}

const { ELECTRON_RUN_AS_NODE: _d, ...env } = process.env;
const app = await electron.launch({
  args: ["."],
  env: { ...env, MAHAAM_E2E: "1", MAHAAM_API_URL: API, MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-issues-")) },
});
const errors = [];
const shots = [];
const shot = async (name) => {
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1]);
  await sleep(450);
  const path = `e2e-shots/issues-${name}.png`;
  execFileSync("screencapture", ["-x", "-o", "-l", id, path]);
  shots.push(path);
};
const send = (c) => app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0].webContents.send("command", cmd), c);

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.waitForLoadState("load");
  await page.locator("#email").waitFor({ timeout: 20000 });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  // The stack is shared with other agents signing in as the same person: one more try if the
  // first sign-in bounces, with what the screen said.
  for (let attempt = 1; ; attempt++) {
    await page.locator("[data-signin-form] button[type=submit]").click();
    const ok = await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (ok) break;
    log(`sign-in attempt ${attempt} did not land:`, (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200));
    if (attempt === 2) fail("could not sign in");
    await page.locator("#password").fill(PASSWORD);
  }
  await page.evaluate(() => window.mahaam.invoke("app:prefs", { locale: "en", theme: "light" }));
  const prefs = (p) => page.evaluate((x) => window.mahaam.invoke("app:prefs", x), p);

  // ── My issues ──
  await send({ type: "navigate", to: { name: "my-issues" } });
  await page.locator("[data-segment=active]").click();
  await page.locator("[data-issue-row]").first().waitFor({ timeout: 15000 });
  const rows = await page.locator("[data-issue-row]").count();
  log("my issues: rows =", rows, "| groups =", await page.locator("[data-group-header]").count());
  await shot("1-my-issues-light-en");

  await page.mouse.move(5, 400); // keep the pointer off the rows: hover also moves the focus
  const focusAt = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll("[data-issue-row]")];
      const i = rows.findIndex((r) => r.hasAttribute("data-focused"));
      return { i, key: rows[i]?.getAttribute("data-issue-row") ?? null };
    });
  await page.keyboard.press("Escape");
  await page.keyboard.press("j");
  const a = await focusAt();
  await page.keyboard.press("j");
  const b = await focusAt();
  await page.keyboard.press("k");
  const c = await focusAt();
  if (a.i < 0 || b.i !== a.i + 1 || c.i !== a.i) fail(`j/k focus is off: ${JSON.stringify([a, b, c])}`);
  const first = c.key;
  log("j/k: focus", a.key, "→", b.key, "→", c.key, a.i === 0 ? "(from the top)" : `(from row ${a.i}: the pointer was over the list)`);

  // S on the focused row: change its status from the keyboard, then check the server.
  const target = await server.get(`/api/w/tasks/${first}`);
  const targetStatuses = (await server.get(`/api/w/projects/${target.project_id}/board`)).statuses.sort((a, b) => a.position - b.position);
  const to = targetStatuses.find((s) => s.id !== target.status_id && s.category === "doing") ?? targetStatuses.find((s) => s.id !== target.status_id);
  restore.push(() => server.post(`/api/w/tasks/${first}/move`, { status: target.status_id }));
  await page.keyboard.press("s");
  await page.locator("[role=menu]").waitFor({ timeout: 5000 });
  await shot("2-status-menu");
  await page.keyboard.type(to.name);
  await page.keyboard.press("Enter");
  await until("the row to show the new status", async () => (await page.locator(`[data-issue-row="${first}"] [data-row-status]`).getAttribute("data-row-status")) === to.name, 3000);
  await until("the server to have the new status", async () => (await server.get(`/api/w/tasks/${first}`)).status_id === to.id);
  log("status via S:", first, target.status.name, "→", to.name, "(server agrees)");

  // Context menu on a row.
  await page.locator(`[data-issue-row="${first}"]`).click({ button: "right" });
  await page.locator(`[data-issue-menu="${first}"]`).waitFor({ timeout: 5000 });
  await shot("3-context-menu");
  await page.keyboard.press("Escape");
  await until("the context menu to close", async () => !(await page.locator("[data-issue-menu]").count()));

  // Grouping by project (Display menu), then back.
  await page.locator("[data-action=display]").click();
  await page.locator("[data-grouping=project]").click();
  await until("project groups", async () => (await page.locator('[data-group^="p:"]').count()) > 0);
  await shot("4-my-issues-by-project");
  await page.locator("[data-action=display]").click();
  await page.locator("[data-grouping=status]").click();

  // ── A project: list, then board ──
  await send({ type: "navigate", to: { name: "project", id: project.id, view: "list" } });
  await page.locator("[data-project-mode=list] [data-issue-row]").first().waitFor({ timeout: 15000 });
  await shot("5-project-list");
  await page.locator("[data-segment=board]").click();
  await page.locator("[data-card]").first().waitFor({ timeout: 10000 });
  await shot("6-project-board");

  // Drag the last card of the backlog into the to-do column.
  const b1 = await server.get(`/api/w/projects/${project.id}/board`);
  const movable = b1.tasks.filter((x) => x.status_id === backlog.id).sort((a, b) => a.position - b.position).at(-1) ?? fail("no backlog card to drag");
  restore.push(() => server.post(`/api/w/tasks/${movable.key}/move`, { status: backlog.id }));
  const card = page.locator(`[data-card="${movable.key}"]`);
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const dest = await page.locator(`[data-column-body="${todo.id}"]`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 4 });
  await page.mouse.move(dest.x + dest.width / 2, dest.y + 30, { steps: 12 });
  await sleep(150);
  await page.mouse.move(dest.x + dest.width / 2, dest.y + 34, { steps: 3 });
  await page.mouse.up();
  await until("the card to sit in the to-do column", async () => (await page.locator(`[data-column-body="${todo.id}"] [data-card="${movable.key}"]`).count()) === 1, 3000);
  await until("the server to have moved it", async () => (await server.get(`/api/w/tasks/${movable.key}`)).status_id === todo.id);
  const b2 = await server.get(`/api/w/projects/${project.id}/board`);
  const col = b2.tasks.filter((x) => x.status_id === todo.id).sort((a, b) => a.position - b.position).map((x) => x.key);
  log("drag:", movable.key, backlog.name, "→", todo.name, "| server column:", col.join(" "));
  await shot("7-board-after-drag");

  // Reorder inside a column: the backlog's last card to the top.
  const b3 = await server.get(`/api/w/projects/${project.id}/board`);
  const back = b3.tasks.filter((x) => x.status_id === backlog.id).sort((a, b) => a.position - b.position);
  if (back.length >= 2) {
    const last = back.at(-1);
    restore.push(() => server.post(`/api/w/tasks/${last.key}/move`, { status: backlog.id, index: back.length - 1 }));
    const src = await page.locator(`[data-card="${last.key}"]`).boundingBox();
    const top = await page.locator(`[data-card="${back[0].key}"]`).boundingBox();
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 - 10, { steps: 4 });
    await sleep(120); // let dnd-kit pick the card up before it travels
    await page.mouse.move(top.x + top.width / 2, top.y + 8, { steps: 20 });
    await sleep(150);
    await page.mouse.up();
    await until("the server to put it first", async () => {
      const b = await server.get(`/api/w/projects/${project.id}/board`);
      return b.tasks.filter((x) => x.status_id === backlog.id).sort((a, c) => a.position - c.position)[0]?.key === last.key;
    });
    log("reorder:", last.key, "moved to the top of", backlog.name, "(server agrees)");
  }

  // "+" on a column opens quick create in that status.
  const doing = statuses.find((s) => s.category === "doing") ?? todo;
  await page.locator(`[data-column-add="${doing.name}"]`).click();
  await page.locator("[data-create-issue]").waitFor({ timeout: 5000 });
  await until("the status preset", async () => (await page.locator("[data-create-issue]").innerText()).includes(doing.name), 5000);
  const tempTitle = `E2E temp ${Date.now() % 100000}`;
  await page.locator("[data-create-title]").fill(tempTitle);
  await page.keyboard.press("Meta+Enter");
  const temp = await until("the new issue on the server", async () =>
    (await server.get(`/api/w/tasks?project=${project.id}&q=${encodeURIComponent(tempTitle)}`)).tasks?.find((x) => x.title === tempTitle),
  );
  restore.push(() => server.del(`/api/w/tasks/${temp.key}`).catch(() => {}));
  if (temp.status_id !== doing.id) fail(`quick create from "${doing.name}" landed in another status`);
  await until("the new card on the board", async () => (await page.locator(`[data-column-body="${doing.id}"] [data-card="${temp.key}"]`).count()) === 1);
  log("quick create from the column:", temp.key, "in", doing.name);

  // Filter by text.
  await page.locator("[data-filter-text]").fill(temp.key);
  await until("only the match on the board", async () => (await page.locator("[data-card]").count()) === 1, 3000);
  await shot("7b-board-filtered");
  await page.locator("[data-filter-text]").press("Escape");
  await until("the filter cleared", async () => (await page.locator("[data-card]").count()) > 1, 3000);

  // Delete it from the keyboard: hover, ⌘⌫, confirm.
  const tb = await page.locator(`[data-card="${temp.key}"]`).boundingBox();
  await page.mouse.move(tb.x + 20, tb.y + 20);
  await page.mouse.move(tb.x + 30, tb.y + 24);
  await page.keyboard.press("Meta+Backspace");
  await page.locator("[data-confirm-delete]").waitFor({ timeout: 5000 });
  await shot("7c-delete-confirm");
  await page.locator("[data-confirm]").click();
  await until("the server to have deleted it", async () => !(await server.get(`/api/w/tasks?project=${project.id}&q=${encodeURIComponent(tempTitle)}`)).tasks?.length);
  await until("the card gone", async () => (await page.locator(`[data-card="${temp.key}"]`).count()) === 0);
  log("deleted via ⌘⌫:", temp.key);
  await page.mouse.move(5, 400);

  // Board keyboard: arrows move the focus, Enter opens.
  await page.mouse.move(5, 400);
  await page.keyboard.press("ArrowDown");
  const f1 = await page.locator("[data-card][data-focused]").getAttribute("data-card");
  await page.keyboard.press("ArrowRight");
  const f2 = await page.locator("[data-card][data-focused]").getAttribute("data-card");
  log("board arrows:", f1, "→", f2);
  if (!f1 || !f2 || f1 === f2) fail("board arrow keys did not move the focus across columns");

  // About panel.
  await page.locator("[data-action=about]").click();
  await page.locator("[data-about] [data-progress]").waitFor({ timeout: 5000 });
  await shot("8-board-about");
  await page.locator("[data-action=about]").click();

  // ── One issue ──
  await send({ type: "navigate", to: { name: "issue", key: movable.key } });
  await page.locator("[data-issue-title]").waitFor({ timeout: 10000 });
  const before = await server.get(`/api/w/tasks/${movable.key}`);
  restore.push(() => server.patch(`/api/w/tasks/${movable.key}`, { title: before.title }));
  const newTitle = `${before.title} (desktop)`;
  await page.locator("[data-issue-title]").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (desktop)");
  await page.keyboard.press("Enter");
  await until("the server title", async () => (await server.get(`/api/w/tasks/${movable.key}`)).title === newTitle);
  log("title saved:", JSON.stringify(newTitle));

  // Description: E edits, ⌘↵ saves, and it renders as markdown.
  restore.push(() => server.patch(`/api/w/tasks/${movable.key}`, { description: before.description ?? "" }));
  await page.locator("[data-issue-title]").evaluate((el) => el.blur());
  await page.keyboard.press("e");
  await page.locator("[data-description-editor] textarea").waitFor({ timeout: 3000 });
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("Checked on the **desktop**:\n\n- lists\n- the board");
  await page.keyboard.press("Meta+Enter");
  await until("the server description", async () => ((await server.get(`/api/w/tasks/${movable.key}`)).description ?? "").includes("**desktop**"));
  await page.locator("[data-description] strong").waitFor({ timeout: 3000 });
  if ((await page.locator("[data-description] li").count()) !== 2) fail("the description's list did not render");
  log("description saved and rendered as markdown");

  // Comment (⌘↵ sends).
  const body = `Checked from the desktop app — **issues e2e** ${Date.now()}`;
  await page.locator("[data-composer] textarea").click();
  await page.keyboard.type(body);
  await page.keyboard.press("Meta+Enter");
  const comment = await until("the comment on the server", async () => (await server.get(`/api/w/tasks/${movable.key}/comments`)).comments?.find((c) => c.body === body));
  restore.push(() => server.del(`/api/w/comments/${comment.id}`));
  await until("the comment in the thread", async () => (await page.locator(`[data-comment="${comment.id}"]`).count()) === 1);
  log("comment posted and shown:", comment.id);

  // Checklist: add, tick.
  const item = `E2E item ${Date.now() % 10000}`;
  if (!(await page.locator("[data-checklist-add]").count())) await page.locator("[data-checklist] button[aria-label]").first().click();
  await page.locator("[data-checklist-add]").fill(item);
  await page.keyboard.press("Enter");
  const added = await until("the checklist item on the server", async () => (await server.get(`/api/w/tasks/${movable.key}`)).checklist?.find((c) => c.title === item));
  restore.push(() => server.del(`/api/w/checklist/${added.id}`));
  if (!(await page.locator("[data-checklist-add]:focus").count())) fail("the add field should stay open for the next item");
  await page.keyboard.press("Escape");
  if (!(await page.locator("[data-issue-title]").count())) fail("Esc in the checklist field left the issue");
  const row = page.locator(`[data-checklist-item="${item}"]`);
  await until("the real item in the list", async () => (await row.locator("[role=checkbox]:not([data-disabled])").count()) === 1).catch(async (e) => {
    log("checklist DOM:", await page.locator("[data-checklist]").evaluate((el) => el.outerHTML.slice(0, 3000)));
    throw e;
  });
  await row.locator("[role=checkbox]").click();
  await until("the item ticked on the server", async () => (await server.get(`/api/w/tasks/${movable.key}`)).checklist?.find((c) => c.id === added.id)?.done === true);
  log("checklist: added and ticked", JSON.stringify(item));

  // Timer: T starts it on this issue, T again stops it. Others share this account, so a timer
  // may be started elsewhere meanwhile; we only check ours.
  await page.locator("[data-issue]").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("t");
  await until("the timer to run on this issue", async () => (await page.locator("[data-issue-timer=running]").count()) === 1, 8000);
  const running = (await server.get("/api/w/time/running")).timer;
  log("timer running on:", running?.task_key, running?.task_key === movable.key ? "(server agrees)" : "(changed by someone else meanwhile)");
  await shot("9-issue-light-en");
  await page.keyboard.press("t");
  await until("the timer to stop", async () => (await page.locator("[data-issue-timer=idle]").count()) === 1, 8000);
  log("timer stopped");

  // Esc goes back.
  await page.keyboard.press("Escape");
  await until("back on the board", async () => (await page.locator("[data-card]").count()) > 0, 5000);

  // 404.
  await send({ type: "navigate", to: { name: "issue", key: "MH-999999" } });
  await page.locator("[data-issue-back]").waitFor({ timeout: 10000 });
  await shot("10-issue-404");

  // ── Projects table ──
  await send({ type: "navigate", to: { name: "projects" } });
  await page.locator("[data-project-row]").first().waitFor({ timeout: 10000 });
  await page.mouse.move(5, 400);
  await page.keyboard.press("j");
  await shot("11-projects-light-en");
  await page.keyboard.press("Enter");
  await until("a project opened from the table", async () => (await page.locator("[data-project-mode]").count()) === 1, 5000);

  // ── en/ar × light/dark ──
  for (const [locale, theme] of [
    ["en", "dark"],
    ["ar", "light"],
    ["ar", "dark"],
  ]) {
    await prefs({ locale, theme });
    await until(`${locale}/${theme}`, () => page.evaluate(([l, th]) => document.documentElement.lang === l && document.documentElement.classList.contains("dark") === (th === "dark"), [locale, theme]));
    await send({ type: "navigate", to: { name: "my-issues" } });
    await page.locator("[data-issue-row]").first().waitFor({ timeout: 10000 });
    await shot(`my-issues-${theme}-${locale}`);
    await send({ type: "navigate", to: { name: "project", id: project.id, view: "board" } });
    await page.locator("[data-card]").first().waitFor({ timeout: 10000 });
    await shot(`board-${theme}-${locale}`);
    await send({ type: "navigate", to: { name: "project", id: project.id, view: "list" } });
    await page.locator("[data-project-mode=list] [data-issue-row]").first().waitFor({ timeout: 10000 });
    await shot(`list-${theme}-${locale}`);
    await send({ type: "navigate", to: { name: "issue", key: movable.key } });
    await page.locator("[data-issue-title]").waitFor({ timeout: 10000 });
    await page.locator(`[data-comment="${comment.id}"]`).waitFor({ timeout: 10000 });
    await shot(`issue-${theme}-${locale}`);
    await send({ type: "navigate", to: { name: "projects" } });
    await page.locator("[data-project-row]").first().waitFor({ timeout: 10000 });
    await shot(`projects-${theme}-${locale}`);
  }
  await prefs({ locale: "en", theme: "light" });

  const real = errors.filter((e) => !/Failed to load resource/.test(e));
  if (real.length) fail(`page errors:\n${real.join("\n")}`);
  log("screenshots:", shots.join(" "));
  log("PASS");
} finally {
  for (const fn of restore.reverse()) await fn().catch((e) => log("cleanup:", e.message));
  for (const l of madeLabels) log("kept label for later runs:", l.name);
  await app.close().catch(() => {});
}
