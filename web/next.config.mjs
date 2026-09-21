/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8110";

const nextConfig = {
  // A self-contained server (.next/standalone) for the production image: web/Dockerfile copies
  // only it, .next/static and public, so the image carries no node_modules tree.
  output: "standalone",

  // Next 16 dev blocks its own dev resources (/_next/*, HMR) for any origin but the one it was
  // started on, so a page opened on 127.0.0.1 while the server was started as localhost never
  // hydrates — the SSR shell renders and nothing client-side runs. List both loopback names.
  // console.mahaam.app (and the old managy-app.fadymondy.com) is the progress preview: Cloudflare → NPM → SSH reverse tunnel → this dev server.
  allowedDevOrigins: ["127.0.0.1", "localhost", "console.mahaam.app", "managy-app.fadymondy.com"],

  // The Go API and this app feel like one origin: /api and /graphql are proxied to the API, so
  // the togo_session cookie and the CSRF cookie are first-party. Realtime (/events) is not in P0.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/graphql", destination: `${API_ORIGIN}/graphql` },
      // The embeddable feedback loader/bundle is served by the Go API; proxy it so
      // the snippet's {app-origin}/embed/v1.js works on the public host too.
      { source: "/embed/:path*", destination: `${API_ORIGIN}/embed/:path*` },
      // MCP OAuth discovery metadata (RFC 8414/9728) — served by the Go API, not a Next.js page.
      { source: "/.well-known/:path*", destination: `${API_ORIGIN}/.well-known/:path*` },
      // The shadcn registry (npx shadcn add @mahaam/feedback) is built in the mahaam-feedback
      // repo and published to GitHub Pages; proxy it so the install URL is on the brand domain.
      { source: "/r/:path*", destination: "https://fadymondy.github.io/mahaam-feedback/r/:path*" },
    ];
  },

  // The service worker is never cached. Dev only: never let a browser keep a stale page or chunk (dev chunk names are stable).
  async headers() {
    // The service worker must be re-checked on every load so a deploy reaches installed apps.
    const sw = { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] };
    // The embeddable feedback widget loads these fonts from other sites: they are public.
    const fonts = {
      source: "/fonts/:path*",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    };
    if (process.env.NODE_ENV !== "development") return [sw, fonts];
    return [
      sw,
      fonts,
      {
        source: "/:path((?!api|graphql|embed).*)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
