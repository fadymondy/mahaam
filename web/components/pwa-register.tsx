"use client"

import { useEffect } from "react"

// Registers public/sw.js (production only — in dev a worker would fight HMR with stale chunks).
export function PwaRegister() {
  useEffect(() => {
    // The desktop app is always online-first and updates with the site; a worker would only pin stale chunks.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || window.mahaamDesktop) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {})
  }, [])
  return null
}
