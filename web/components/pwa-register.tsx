"use client"

import { useEffect } from "react"

// Registers public/sw.js (production only — in dev a worker would fight HMR with stale chunks).
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {})
  }, [])
  return null
}
