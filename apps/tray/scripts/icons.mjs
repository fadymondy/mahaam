// Writes build/icon.png from the bundled icon script (run after build-main).
import { execFileSync } from "node:child_process";
execFileSync(process.execPath, ["dist-electron/make-icons.cjs"], { stdio: "inherit" });
