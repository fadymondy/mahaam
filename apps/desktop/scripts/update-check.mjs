// The update loader, end to end with a simulated release (MAHAAM_FAKE_UPDATE=1 plays checking →
// downloading with progress → ready): the sidebar shows the download, then the restart prompt, and
// "Restart to update" hands off to the installer.
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { ELECTRON_RUN_AS_NODE: _d, E2E_EMAIL, E2E_PASSWORD, ...env } = process.env;
mkdirSync("e2e-shots", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: { ...env, MAHAAM_E2E: "1", MAHAAM_FAKE_UPDATE: "1", MAHAAM_API_URL: env.MAHAAM_API_URL ?? "http://127.0.0.1:3020", MAHAAM_USER_DATA: mkdtempSync(join(tmpdir(), "mahaam-upd-")) },
});
const shot = async (path) => {
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("surface=main")).getMediaSourceId().split(":")[1]);
  await new Promise((r) => setTimeout(r, 400));
  execFileSync("screencapture", ["-x", "-o", "-l", id, path]);
};
try {
  await app.firstWindow();
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = app.windows().find((w) => w.url().includes("surface=main"));
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  await page.locator("#email").fill(E2E_EMAIL);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.locator("[data-signin-form] button[type=submit]").click();
  await page.locator("aside[data-sidebar]").waitFor({ timeout: 20000 });
  await app.evaluate(() => void globalThis.mahaamCheckUpdates());
  await page.locator("[data-update=downloading]").waitFor({ timeout: 15000 });
  console.log("[update] downloading:", (await page.locator("[data-update=downloading]").innerText()).replace(/\n/g, " "));
  await shot("e2e-shots/update-1-downloading.png");
  await page.locator("[data-update=ready]").waitFor({ timeout: 15000 });
  console.log("[update] ready:", (await page.locator("[data-update=ready]").innerText()).replace(/\n/g, " "));
  await shot("e2e-shots/update-2-ready.png");
  await page.locator("[data-update-install]").click();
  await page.locator("[data-update]").waitFor({ state: "detached", timeout: 5000 });
  console.log("[update] Restart to update → handed to the installer (fake: back to idle)");
  await page.evaluate(() => window.mahaam.invoke("session:signOut"));
  console.log("[update] PASS");
} finally {
  await app.close();
}
