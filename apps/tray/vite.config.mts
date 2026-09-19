import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The popover makes no network requests of its own (the main process does), so production CSP
// allows nothing but its own files. Dev relaxes script/connect for Vite's HMR client.
const PROD_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ws://localhost:5174; object-src 'none'";

function csp(): Plugin {
  let dev = true;
  return {
    name: "mahaam-csp",
    configResolved(c) {
      dev = c.command === "serve";
    },
    transformIndexHtml(html) {
      return html.replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${dev ? DEV_CSP : PROD_CSP}" />`);
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), csp()],
  server: { port: 5174, strictPort: true },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: "chrome140",
  },
});
