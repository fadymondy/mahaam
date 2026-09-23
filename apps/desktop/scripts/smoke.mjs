// Quick look: launch the built app on a fresh profile, sign in, screenshot the window.
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { ELECTRON_RUN_AS_NODE: _d, ...env } = process.env;
mkdirSync("e2e-shots", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...env, MAHAAM_E2E: "1", MAHAAM_API_URL: process.env.MAHAAM_API_URL ?? "http://127.0.0.1:3020", MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-desktop-")) },
});
const shot = async (path) => {
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1]);
  await new Promise((r) => setTimeout(r, 500));
  execFileSync("screencapture", ["-x", "-o", "-l", id, path]);
};
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.waitForLoadState("load");
await page.locator("#email").waitFor({ timeout: 15000 });
await shot("e2e-shots/smoke-1-signin.png");
await page.locator("#email").fill(process.env.E2E_EMAIL);
await page.locator("#password").fill(process.env.E2E_PASSWORD);
await page.locator("[data-signin-form] button[type=submit]").click();
await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await shot("e2e-shots/smoke-2-shell.png");
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("command", { type: "palette" }));
await page.locator("[data-palette]").waitFor({ timeout: 5000 });
await page.keyboard.type("MH");
await page.waitForTimeout(800);
await shot("e2e-shots/smoke-3-palette.png");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
console.log("active:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160)), "dialogs:", await page.locator("[role=dialog]").count());
await page.keyboard.press("c");
await page.locator("[data-create-issue]").waitFor({ timeout: 5000 });
await page.waitForTimeout(600);
await shot("e2e-shots/smoke-4-create.png");
console.log("errors:", errors);
await app.close();
