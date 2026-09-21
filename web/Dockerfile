# Mahaam web — production Next.js, built in the container (the host Turbopack build trips on
# the out-of-root symlinks; see the fadymondy.com-v2 memory "Prod build fails silently").
# Multi-stage: `next build` with output: "standalone" (next.config.mjs), then a runtime image
# with only .next/standalone, .next/static and public — no node_modules tree, several times smaller.
# NOTE: do NOT set NODE_ENV=production before `npm ci` — it drops devDependencies
# (tailwind/postcss) and the build fails. `next build` is production regardless.
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# API_ORIGIN is baked into the rewrites at build time: /api, /graphql and /embed go to the API.
ENV API_ORIGIN=http://api:8110
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time (not readable at runtime).
# This is the URL an external MCP client (Claude Desktop, Cursor, ChatGPT, ...) is told to call —
# the public domain, which the web server's own rewrite above proxies to the API container.
ENV NEXT_PUBLIC_MCP_ORIGIN=https://console.mahaam.app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3010 HOSTNAME=0.0.0.0 API_ORIGIN=http://api:8110
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3010
CMD ["node", "server.js"]
