// Mahaam service worker: makes the console installable and shows an offline page.
// Data never comes from a cache — /api, /graphql, /embed and the SSE stream always hit the network,
// so a stale task list or a signed-out session can't be served. Only hashed build assets are cached.
const CACHE = "mahaam-v2"
const PRECACHE = ["/offline.html", "/icons/icon-192.png"]

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (e) => {
  const req = e.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (/^\/(api|graphql|embed)(\/|$)/.test(url.pathname)) return

  // Pages: always the network; the offline page only when it is unreachable.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")))
    return
  }
  // Content-hashed build output, fonts and icons never change under the same URL: cache-first.
  if (/^\/(_next\/static|fonts|icons)\//.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})

// Web Push (internal/push): { title, body, url, tag }. url is an app path such as /w/acme/time;
// proxy.ts adds the language when it is opened.
self.addEventListener("push", (e) => {
  let m = {}
  try {
    m = e.data ? e.data.json() : {}
  } catch {
    m = { title: e.data ? e.data.text() : "" }
  }
  e.waitUntil(
    self.registration.showNotification(m.title || "Mahaam", {
      body: m.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: m.tag || undefined,
      data: { url: m.url || "/" },
    }),
  )
})

// Focus an open Mahaam window (and navigate it) rather than opening a second one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w))
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
