import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// npm run dev:extension — serves popup.html in a normal tab with a chrome.* shim and proxies the
// API (MAHAAM_DEV_API, default http://localhost:8120) so login's CSRF cookie is same-origin.
const target = process.env.MAHAAM_DEV_API ?? "http://localhost:8120";
export default defineConfig({
  plugins: [react()],
  define: { __MAHAAM_API__: JSON.stringify("") },
  server: {
    port: 5175,
    strictPort: true,
    open: "/popup.html",
    proxy: { "/api": { target, changeOrigin: true } },
  },
});
