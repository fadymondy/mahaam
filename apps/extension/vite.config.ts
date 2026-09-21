import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The API the extension talks to by default, and the only host it is granted at install.
// Override at build time for self-hosted servers or local dev:
//   MAHAAM_API_URL=http://localhost:8120 npm run build:extension
const API = (process.env.MAHAAM_API_URL ?? "https://console.mahaam.app").replace(/\/+$/, "");
const apiHost = (() => {
  const u = new URL(API);
  return `${u.protocol}//${u.hostname}/*`;
})();

function manifest(): Plugin {
  return {
    name: "mahaam-manifest",
    generateBundle() {
      const m = JSON.parse(readFileSync(resolve(__dirname, "manifest.json"), "utf8"));
      m.host_permissions = [apiHost];
      this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(m, null, 2) });
    },
  };
}

// Plain multi-entry build: popup + options pages and the module service worker, with fixed names
// so manifest.json can point at them.
export default defineConfig({
  plugins: [react(), tailwind(), manifest()],
  base: "",
  define: { __MAHAAM_API__: JSON.stringify(API) },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome127",
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        options: resolve(__dirname, "options.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (c) => (c.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
