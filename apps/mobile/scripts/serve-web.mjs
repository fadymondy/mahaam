// Serve a web export of one variant and proxy /api/* to the Mahaam API on the same origin.
// The API's CORS list names only the Next app, and a browser can't send the CSRF cookie cross-site,
// so the web target (used for QA) must be same-origin with /api.
//
//   node scripts/serve-web.mjs [team|client] [port] [api]
//   defaults: team, 8091 (client 8092), http://localhost:8120
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const variant = process.argv[2] === "client" ? "client" : "team";
const port = Number(process.argv[3] ?? (variant === "client" ? 8092 : 8091));
const api = new URL(process.argv[4] ?? process.env.MAHAAM_API ?? "http://localhost:8120");
const root = join(fileURLToPath(new URL("..", import.meta.url)), "dist", variant);
if (!existsSync(join(root, "index.html"))) {
  console.error(`no export at ${root} — run: npm run export:web:${variant}`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const up = http.request(
        { hostname: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", (e) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `api unreachable: ${e.message}` }));
      });
      req.pipe(up);
      return;
    }
    const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^([/\\])+/, "");
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html"); // SPA fallback
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Mahaam ${variant} web on http://localhost:${port} → API ${api.origin}`));
