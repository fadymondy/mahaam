"use client"

// "Get the Mahaam app": install the PWA and turn on push notifications for this device. Same
// dialog language as the feedback SDK's report dialog (shadcn Dialog, header, grouped fields,
// footer action). Opens once on its own (until dismissed) and from the header's download button.
import { useCallback, useEffect, useState } from "react"
import { BellIcon, BellOffIcon, CheckIcon, DownloadIcon, ShareIcon, SmartphoneIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { errorText } from "@/lib/work"

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
type PushState = { enabled: boolean; public_key: string; devices: number }

const DISMISS_KEY = "mahaam.app-prompt.dismissed"

// beforeinstallprompt fires once, often before React mounts: keep it at module level.
let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

function standalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Whether the header should offer the dialog at all (not already installed + subscribed). */
export function useAppPrompt() {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return { canInstall: deferred !== null, installed: standalone() }
}

export function AppInstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useTranslations()
  const { canInstall, installed } = useAppPrompt()
  const [push, setPush] = useState<PushState | null>(null)
  const [subscribed, setSubscribed] = useState<PushSubscription | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pushSupported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

  const refresh = useCallback(async () => {
    try {
      setPush(await api<PushState>("/api/me/push"))
    } catch {
      setPush(null)
    }
    if (pushSupported) {
      const reg = await navigator.serviceWorker.getRegistration()
      setSubscribed((await reg?.pushManager.getSubscription()) ?? null)
    }
  }, [pushSupported])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  function close(o: boolean) {
    if (!o) localStorage.setItem(DISMISS_KEY, "1")
    onOpenChange(o)
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    deferred = null
    listeners.forEach((l) => l())
  }

  async function enablePush() {
    if (!push?.enabled) return
    setBusy(true)
    setError(null)
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setError(t("pwa.permissionDenied"))
        return
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"))
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(push.public_key) })
      await api("/api/me/push", { method: "POST", json: { subscription: { endpoint: sub.toJSON().endpoint, keys: sub.toJSON().keys }, locale } })
      setSubscribed(sub)
      await refresh()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  async function disablePush() {
    if (!subscribed) return
    setBusy(true)
    setError(null)
    try {
      await api("/api/me/push", { method: "DELETE", json: { endpoint: subscribed.endpoint } })
      await subscribed.unsubscribe()
      setSubscribed(null)
      await refresh()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("pwa.title")}</DialogTitle>
            <DialogDescription>{t("pwa.description")}</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel>
                <SmartphoneIcon className="size-4" /> {t("pwa.installLabel")}
              </FieldLabel>
              {installed ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckIcon className="size-4 text-primary" /> {t("pwa.installed")}
                </p>
              ) : canInstall ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" className="gap-2" onClick={() => void install()}>
                    <DownloadIcon /> {t("pwa.install")}
                  </Button>
                  <span className="text-sm text-muted-foreground">{t("pwa.installHint")}</span>
                </div>
              ) : isIOS() ? (
                <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                  {t("pwa.iosBefore")} <ShareIcon className="inline size-4" /> {t("pwa.iosAfter")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("pwa.browserMenu")}</p>
              )}
            </Field>

            <Field>
              <FieldLabel>
                <BellIcon className="size-4" /> {t("pwa.pushLabel")}
              </FieldLabel>
              {!pushSupported ? (
                <p className="text-sm text-muted-foreground">{isIOS() ? t("pwa.pushIos") : t("pwa.pushUnsupported")}</p>
              ) : push && !push.enabled ? (
                <p className="text-sm text-muted-foreground">{t("pwa.pushOff")}</p>
              ) : subscribed ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckIcon className="size-4 text-primary" /> {t("pwa.pushOn")}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => void disablePush()}>
                    <BellOffIcon /> {t("pwa.pushDisable")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("pwa.pushHint")}</p>
              )}
            </Field>
          </FieldGroup>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            {pushSupported && push?.enabled && !subscribed ? (
              <Button type="button" className="gap-2" disabled={busy} onClick={() => void enablePush()}>
                <BellIcon /> {busy ? t("pwa.enabling") : t("pwa.pushEnable")}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t("pwa.done")}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Open the dialog by itself once, a few seconds after sign-in, unless dismissed before. */
export function useAutoOpenAppPrompt(enabled: boolean, open: () => void) {
  useEffect(() => {
    if (!enabled || process.env.NODE_ENV !== "production" || window.mahaamDesktop) return
    if (localStorage.getItem(DISMISS_KEY) || standalone()) return
    const id = window.setTimeout(open, 4000)
    return () => window.clearTimeout(id)
  }, [enabled, open])
}
