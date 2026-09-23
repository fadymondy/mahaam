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
// The API the extension was BUILT against — the popup has it compiled in, so the test has to be
// told separately.
const API = process.env.MAHAAM_API_URL ?? "http://localhost:8120";
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
// What the extension says about itself while it runs. An uncaught error or a CSP violation is a
// failure — both have shipped silently before (a blocked inline <style>, a data: fetch). HTTP
// errors are only logged: some are the expected answer (a 409 for an overlapping entry).
const noise = [];
const watch = (p, tag) => {
  p.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    noise.push(`${tag} ${m.type()}: ${text.slice(0, 200)}`);
    if (/Content Security Policy/i.test(text)) fail(`${tag}: CSP violation — ${text.slice(0, 160)}`);
  });
  p.on("pageerror", (e) => fail(`${tag}: uncaught ${String(e).slice(0, 200)}`));
  p.on("requestfailed", (r) => noise.push(`${tag} request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`));
};

try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(sw.url()).host;
  log("service worker up:", sw.url());
  sw.on("console", (m) => {
    if (m.type() === "error") fail(`service worker: ${m.text().slice(0, 200)}`);
  });

  const page = await ctx.newPage();
  watch(page, "popup");
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
  // The clock is recomputed from started_at every second; it must count up on its own, without
  // the popup being reopened. It once sat at 0:00 for as long as the popup stayed open.
  const clockSecs = async () => {
    const text = (await page.locator(".mgy-timer-running .mgy-clock").innerText()).trim();
    return { text, secs: text.split(":").reduce((s, p) => s * 60 + Number(p), 0) };
  };
  await page.waitForTimeout(1500);
  const c1 = await clockSecs();
  await page.waitForTimeout(3000);
  const c2 = await clockSecs();
  log("timer clock:", JSON.stringify(c1.text), "then", JSON.stringify(c2.text), "3s later");
  if (!(c2.secs > 0)) fail(`the running timer's clock reads ${JSON.stringify(c2.text)} 4.5s after starting`);
  if (!(c2.secs >= c1.secs + 2)) fail(`the running timer's clock did not tick: ${JSON.stringify(c1.text)} then ${JSON.stringify(c2.text)} 3s later`);
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  log("timer running; badge =", JSON.stringify(badge));
  if (!badge) fail("no badge while a timer runs");
  await page.screenshot({ path: "e2e-shots/ext-running.png" });

  // The badge counts whole minutes, so it must turn over when the running entry's minute does —
  // not whenever a once-a-minute alarm, started at install, next happens to fire. That alarm read
  // "0m" for up to two minutes after a start. Rather than wait a real minute, move the worker's
  // clock to just before the entry's first minute and let the worker repaint.
  const startedAt = await page.evaluate(async (args) => {
    const r = await fetch(`${args.api}/api/w/time/running`, { headers: { Authorization: `Bearer ${args.token}`, "X-Workspace-ID": args.ws } });
    return Date.parse((await r.json()).timer.started_at);
  }, {
    api: API,
    token: (await sw.evaluate(() => chrome.storage.session.get("token"))).token,
    ws: (await sw.evaluate(() => chrome.storage.local.get("workspace"))).workspace.id,
  });
  await sw.evaluate((at) => {
    const real = Date.now.bind(Date);
    const skew = at + 59_000 - real();
    globalThis.__e2eRealNow = real;
    Date.now = () => real() + skew;
  }, startedAt);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
  await page.waitForTimeout(400);
  const at59 = await sw.evaluate(() => chrome.action.getBadgeText({}));
  await page.waitForTimeout(2600);
  const at61 = await sw.evaluate(() => chrome.action.getBadgeText({}));
  await sw.evaluate(() => {
    Date.now = globalThis.__e2eRealNow;
  });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
  await page.waitForTimeout(500);
  log("badge at 0:59 →", JSON.stringify(at59), "at 1:01 →", JSON.stringify(at61));
  if (at59 !== "0m") fail(`the badge reads ${JSON.stringify(at59)} 59s into a timer`);
  if (at61 !== "1m") fail(`the badge did not turn over with the minute: ${JSON.stringify(at61)} 61s into a timer`);

  // The worker must notice the token going (a sign-out, a revoked PAT) on its own. It lives in
  // storage.session; the worker used to watch storage.local for it and kept counting.
  const token = (await sw.evaluate(() => chrome.storage.session.get("token"))).token;
  await sw.evaluate(() => chrome.storage.session.remove("token"));
  await page.waitForTimeout(1500);
  const afterSignOut = await sw.evaluate(() => chrome.action.getBadgeText({}));
  if (afterSignOut) fail(`the badge still reads ${JSON.stringify(afterSignOut)} after the token was removed`);
  await sw.evaluate((t) => chrome.storage.session.set({ token: t }), token);
  log("badge follows the session token:", JSON.stringify(afterSignOut), "after removal");
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

  // Filing WITH a screenshot goes through the multipart intake instead of the JSON one, so this
  // checks the picture actually reaches the server rather than just that the form rendered.
  const onePixelJpeg =
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////" +
    "////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgB" +
    "AQABPxA//9k=";
  await sw.evaluate((shot) => chrome.storage.session.set({
    pending: { url: "https://example.com/broken", title: "Broken page", mode: "issue", screenshot: shot },
  }), onePixelJpeg);
  await page.reload();
  await page.getByText("This page").waitFor({ timeout: 10000 });

  const thumb = page.locator(".mgy-shot-thumb");
  if (!(await thumb.isVisible())) fail("the captured screenshot is not shown before sending");
  await page.screenshot({ path: "e2e-shots/ext-page-shot.png" });

  await page.locator(".mgy-page").getByRole("button", { name: "File an issue" }).last().click();
  await page.getByText(/Issue filed: [A-Z]+-\d+/).waitFor({ timeout: 15000 });
  const withShot = (await page.locator(".mgy-ok").innerText()).match(/[A-Z]+-\d+/)?.[0];
  log("filed with a screenshot:", withShot);

  // The server serves it back only if it was actually stored.
  const shotStatus = await page.evaluate(async (args) => {
    const r = await fetch(`${args.api}/api/w/issues/${args.key}/screenshot`, {
      headers: { Authorization: `Bearer ${args.token}`, "X-Workspace-ID": args.ws },
    });
    return { status: r.status, type: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength };
  }, {
    api: API,
    key: withShot,
    token: (await sw.evaluate(() => chrome.storage.session.get("token"))).token,
    ws: (await sw.evaluate(() => chrome.storage.local.get("workspace"))).workspace.id,
  });
  log("screenshot round trip:", JSON.stringify(shotStatus));
  if (shotStatus.status !== 200) fail(`the screenshot did not reach the server (GET returned ${shotStatus.status})`);
  if (!shotStatus.bytes) fail("the stored screenshot is empty");

  // And removing it must actually stop it being sent.
  await sw.evaluate((shot) => chrome.storage.session.set({
    pending: { url: "https://example.com/no-shot", title: "No shot", mode: "issue", screenshot: shot },
  }), onePixelJpeg);
  await page.reload();
  await page.getByText("This page").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Remove screenshot" }).click();
  if (await page.locator(".mgy-shot-thumb").isVisible()) fail("the thumbnail survived Remove");
  await page.locator(".mgy-page").getByRole("button", { name: "File an issue" }).last().click();
  await page.getByText(/Issue filed: [A-Z]+-\d+/).waitFor({ timeout: 15000 });
  log("filed after removing the screenshot:", (await page.locator(".mgy-ok").innerText()).match(/[A-Z]+-\d+/)?.[0]);

  // "Log time on this page": the task picker. Opening it used to trip the CSP (Base UI's inline
  // <style>), and a chosen task showed as its internal value ("taskMH-1") instead of its name.
  await sw.evaluate(() => chrome.storage.session.set({ pending: { url: "https://example.com/log", title: "Log page", mode: "log" } }));
  await page.reload();
  await page.getByText("This page").waitFor({ timeout: 10000 });
  const picker = page.locator(".mgy-page .mgy-task-select");
  await picker.click();
  const option = page.getByRole("option").nth(1);
  const optionText = (await option.innerText()).trim();
  await option.click();
  const shown = (await picker.innerText()).trim();
  log("task picker shows:", JSON.stringify(shown));
  if (shown !== optionText) fail(`the task picker shows ${JSON.stringify(shown)} for the option ${JSON.stringify(optionText)}`);

  // Sign-in without a password, from the Mahaam session this browser already has — the only way
  // in for a Google or GitHub account (they have no password to type).
  await sw.evaluate(() => Promise.all([chrome.storage.session.clear(), chrome.storage.local.remove(["workspace", "email"])]));
  await ctx.clearCookies();
  await page.reload();
  const useSession = page.getByRole("button", { name: "Continue with Mahaam in this browser" });
  const opened = ctx.waitForEvent("page", { timeout: 10000 }).catch(() => null);
  await useSession.click();
  await page.getByText("You're not signed in to Mahaam in this browser").waitFor({ timeout: 10000 });
  const signInTab = await opened;
  log("no browser session → sign-in page opened:", signInTab?.url() ?? "(none)");
  if (!signInTab?.url().startsWith(API)) fail("with no browser session, the Mahaam sign-in page did not open");
  // Sign in the way the web app does: same origin, CSRF double-submit, session cookie.
  const web = signInTab ?? (await ctx.newPage());
  await web.goto(`${API}/api/auth/csrf`);
  const webLogin = await web.evaluate(async ({ email, password }) => {
    const { csrf_token } = await (await fetch("/api/auth/csrf")).json();
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token }, body: JSON.stringify({ email, password }) });
    return r.status;
  }, { email: EMAIL, password: PASSWORD });
  if (webLogin !== 200) fail(`signing in on the web returned ${webLogin}`);
  await web.close();
  await page.bringToFront();
  await useSession.click();
  await Promise.race([page.getByText("Next up").waitFor({ timeout: 15000 }), page.getByRole("button", { name: new RegExp(WS) }).first().click({ timeout: 15000 })]).catch(() => null);
  await page.getByText("Next up").waitFor({ timeout: 15000 });
  const viaBrowser = await sw.evaluate(() => chrome.storage.session.get("token"));
  if (!String(viaBrowser.token).startsWith("togo_pat_")) fail("signing in with the browser session did not store a PAT");
  log("signed in with the browser session; PAT stored in session only");

  if (noise.length) log(`console/network noise (${noise.length}):\n  ` + noise.join("\n  "));
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
