/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8110";

const nextConfig = {
  // Next 16 dev blocks its own dev resources (/_next/*, HMR) for any origin but the one it was
  // started on, so a page opened on 127.0.0.1 while the server was started as localhost never
  // hydrates — the SSR shell renders and nothing client-side runs. List both loopback names.
  // (The managy-app tunnel host is added when that tunnel exists.)
  // managy-app.fadymondy.com is the progress preview: Cloudflare → NPM → SSH reverse tunnel → this dev server.
  allowedDevOrigins: ["127.0.0.1", "localhost", "managy-app.fadymondy.com"],

  // The Go API and this app feel like one origin: /api and /graphql are proxied to the API, so
  // the togo_session cookie and the CSRF cookie are first-party. Realtime (/events) is not in P0.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/graphql", destination: `${API_ORIGIN}/graphql` },
      // The embeddable feedback loader/bundle is served by the Go API; proxy it so
      // the snippet's {app-origin}/embed/v1.js works on the public host too.
      { source: "/embed/:path*", destination: `${API_ORIGIN}/embed/:path*` },
    ];
  },

  // Dev only: never let a browser keep a stale page or chunk (dev chunk names are stable).
  async headers() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/:path((?!api|graphql|embed).*)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
