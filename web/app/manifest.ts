import type { MetadataRoute } from "next"

// The installable console (PWA). start_url "/" lets proxy.ts pick the language and send the user
// to their workspaces or to login; public/sw.js makes it installable and gives an offline page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mahaam — مهام",
    short_name: "Mahaam",
    description: "Project management and time tracking.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#8C3FB5",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
