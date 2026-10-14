"use client"

import { useState } from "react"
import { ExternalLinkIcon, GlobeIcon } from "lucide-react"

import { Badge, Button, toast } from "@fadymondy/nasaq/web"

import { Card } from "@/components/work/project/cards"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { hostingStatus, hostingVariant, openHostingPanel, usePortalHosting, type PortalHostingApp } from "@/lib/integrations"
import { errorText } from "@/lib/work"

/*
The project's Hosbah apps on a customer's project overview (MH-1151, MH-1176, MH-1194): each app's
status and domains, and for the client's own contacts a one-time link that signs them into that
app's hosting panel. Nothing shows when no app is linked.
*/
export function PortalHostingCard({ projectId }: { projectId: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const h = usePortalHosting(ws.id, projectId)
  if (!h.data?.connected) return null
  const apps: PortalHostingApp[] = h.data.apps?.length
    ? h.data.apps
    : [{ id: "", name: h.data.name ?? "—", status: h.data.status ?? "", domains: h.data.domains }]
  return (
    <Card title={t("portal.hosting.title")} data-card="hosting">
      <div className="divide-y divide-border" data-portal-hosting>
        {apps.map((a) => (
          <PortalHostingRow key={a.id || "app"} projectId={projectId} app={a} canOpen={h.data!.can_open} />
        ))}
      </div>
    </Card>
  )
}

function PortalHostingRow({ projectId, app, canOpen }: { projectId: string; app: PortalHostingApp; canOpen: boolean }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const open = async () => {
    // Open the tab inside the click so it isn't blocked as a popup, then send it to the link.
    const win = window.open("", "_blank")
    setBusy(true)
    try {
      const link = await openHostingPanel(ws.id, projectId, locale, app.id || undefined)
      if (win) {
        win.opener = null
        win.location.href = link.url
      } else window.location.assign(link.url)
    } catch (err) {
      win?.close()
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  const domains = app.domains ?? []
  return (
    <div className="space-y-3 py-3 first:pt-0 last:pb-0" data-portal-hosting-app={app.id}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
          {app.name}
        </span>
        <Badge variant={hostingVariant(app.status)}>{hostingStatus(t, app.status)}</Badge>
      </div>
      {domains.length ? (
        <ul className="space-y-1">
          {domains.map((d) => (
            <li key={d}>
              <a className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`https://${d}`} target="_blank" rel="noreferrer" dir="ltr">
                <GlobeIcon className="size-3.5 shrink-0" />
                <span className="truncate">{d}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {canOpen ? (
        <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={() => void open()} data-action="open-hosting-panel">
          <ExternalLinkIcon /> {t("portal.hosting.open")}
        </Button>
      ) : null}
    </div>
  )
}
