"use client"

import { useState } from "react"
import { ExternalLinkIcon, GlobeIcon } from "lucide-react"

import { Badge, Button, toast } from "@fadymondy/nasaq/web"

import { Card } from "@/components/work/project/cards"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { hostingStatus, hostingVariant, openHostingPanel, usePortalHosting } from "@/lib/integrations"
import { errorText } from "@/lib/work"

/*
The project's Hosbah app on a customer's project overview (MH-1151, MH-1176): its status and
domains, and for the client's own contacts a one-time link that signs them into that app's
hosting panel. Nothing shows when no app is linked.
*/
export function PortalHostingCard({ projectId }: { projectId: string }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const h = usePortalHosting(ws.id, projectId)
  const [busy, setBusy] = useState(false)
  if (!h.data?.connected) return null
  const open = async () => {
    // Open the tab inside the click so it isn't blocked as a popup, then send it to the link.
    const win = window.open("", "_blank")
    setBusy(true)
    try {
      const link = await openHostingPanel(ws.id, projectId, locale)
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
  const domains = h.data.domains ?? []
  return (
    <Card title={t("portal.hosting.title")} data-card="hosting">
      <div className="space-y-3" data-portal-hosting>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
            {h.data.name}
          </span>
          <Badge variant={hostingVariant(h.data.status)}>{hostingStatus(t, h.data.status)}</Badge>
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
        {h.data.can_open ? (
          <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={() => void open()} data-action="open-hosting-panel">
            <ExternalLinkIcon /> {t("portal.hosting.open")}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
