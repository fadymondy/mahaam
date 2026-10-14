/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8110";

// Security headers on every response (MH-1253): pin HTTPS, no MIME sniffing, no full-URL referrers,
// and the app can only be framed by itself (clickjacking). Nothing embeds these pages cross-origin.
const SECURITY_HEADERS = {
  source: "/:path*",
  headers: [
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  ],
};

const nextConfig = {
  // A self-contained server (.next/standalone) for the production image: web/Dockerfile copies
  // only it, .next/static and public, so the image carries no node_modules tree.
  output: "standalone",

  // Next 16 dev blocks its own dev resources (/_next/*, HMR) for any origin but the one it was
  // started on, so a page opened on 127.0.0.1 while the server was started as localhost never
  // hydrates — the SSR shell renders and nothing client-side runs. List both loopback names.
  // console.mahaam.app (and the old managy-app.fadymondy.com) is the progress preview: Cloudflare → NPM → SSH reverse tunnel → this dev server.
  allowedDevOrigins: ["127.0.0.1", "localhost", "dev.mahaam.app", "console.mahaam.app", "managy-app.fadymondy.com"],

  // The Go API and this app feel like one origin: /api and /graphql are proxied to the API, so
  // the togo_session cookie and the CSRF cookie are first-party. Realtime (/events) is not in P0.
  // The togo auth-oauth plugin sends every Google/GitHub sign-in to a hard-coded /dashboard.
  // Mahaam has no such page; home picks the user's workspace.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/:locale(en|ar)/dashboard", destination: "/:locale", permanent: false },
      // The published Terms and Privacy Policy live on mahaam.app (the store listings link there).
      // The console's own copy is still a draft (LEGAL_REVIEWED = false), so the app's in-app
      // links and any old link land on the published text instead of a page marked "Draft".
      { source: "/:locale(en|ar)/legal/:doc(terms|privacy)", destination: "https://mahaam.app/:locale/:doc", permanent: true },
    ]
  },

  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/graphql", destination: `${API_ORIGIN}/graphql` },
      // Sign in with CircleXO (only live when the API has CIRCLEXO_ISSUER set): the OIDC redirect
      // round trip and the hub launch URL are served by the Go API.
      { source: "/auth/circlexo/:path*", destination: `${API_ORIGIN}/auth/circlexo/:path*` },
      { source: "/sso/circlexo", destination: `${API_ORIGIN}/sso/circlexo` },
      // Connect Hosbah (OAuth through CircleXO or Hosbah): the redirect back is served by the Go API.
      { source: "/integrations/hosbah/callback", destination: `${API_ORIGIN}/integrations/hosbah/callback` },
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
    if (process.env.NODE_ENV !== "development") return [SECURITY_HEADERS, sw, fonts];
    return [
      SECURITY_HEADERS,
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
