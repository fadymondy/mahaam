// npm run dev:tray — Vite dev server for the popover, esbuild watch for main/preload, then Electron.
// MAHAAM_API_URL sets the default server on the sign-in screen (e.g. http://localhost:8120).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const electron = require("electron"); // path to the binary
const DEV_URL = "http://localhost:5174";
const procs = [];
const run = (cmd, args, { shell = false } = {}) => {
  const p = spawn(cmd, args, { stdio: "inherit", shell });
  procs.push(p);
  return p;
};
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);

run("npx vite", [], { shell: true });
run(process.execPath, ["scripts/build-main.mjs", "--watch"]);

const waitFor = async (check) => {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
};
await waitFor(async () => existsSync("dist-electron/main.cjs") && existsSync("dist-electron/preload.cjs"));
await waitFor(() => fetch(DEV_URL).then((r) => r.ok, () => false));
// ELECTRON_RUN_AS_NODE (set by Electron-based parents) would start the app as plain Node.
const { ELECTRON_RUN_AS_NODE: _drop, ...cleanEnv } = process.env;
const app = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...cleanEnv, MAHAAM_DEV_URL: DEV_URL, MAHAAM_API_URL: process.env.MAHAAM_API_URL ?? "http://localhost:8120" },
});
procs.push(app);
process.on("exit", stop);
app.on("exit", () => {
  stop();
  process.exit(0);
});
