"use client"

// "Connect your AI" (P8.5): a customer connects Claude (Code or Desktop) to their own portal over
// MCP. One click mints a personal mhm_ token with the client scopes (portal:read, portal:write) —
// the same POST /api/w/mcp_tokens as the MCP tokens page, never more than the client role allows —
// and shows the endpoint and ready-to-paste configs. The token is shown once.
import { useState } from "react"
import Link from "next/link"
import { BotIcon, KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { CopyField } from "@/components/copy-field"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

// The MCP endpoint's origin: configured (NEXT_PUBLIC_MCP_ORIGIN, as on the MCP tokens page), else this
// site's origin (next.config proxies /api/* to the API).
function mcpURL() {
  const origin = process.env.NEXT_PUBLIC_MCP_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "")
  return `${origin}/api/mcp`
}

export function ConnectAiCard() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const url = mcpURL()
  const shown = token ?? "mhm_…"

  const mint = async () => {
    setBusy(true)
    try {
      const out = await api<{ plaintext: string }>("/api/w/mcp_tokens", {
        method: "POST",
        json: { name: `Claude · ${ws.summary.name}`, scopes: ["portal:read", "portal:write"], expires_in_days: 365 },
        workspaceId: ws.id,
      })
      setToken(out.plaintext)
      toast.success(t("connectAi.created"))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  const claudeCode = `claude mcp add --transport http mahaam ${url} --header "Authorization: Bearer ${shown}"`
  const desktop = JSON.stringify(
    { mcpServers: { mahaam: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${shown}`] } } },
    null,
    2,
  )

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card" data-connect-ai>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-grid-action/5 px-5 py-4">
        <span className="grid size-10 place-items-center rounded-lg bg-grid-action/15 text-grid-action">
          <BotIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">{t("connectAi.title")}</h2>
          <p className="text-sm text-grid-muted">{t("connectAi.body")}</p>
        </div>
        {!token ? (
          <Button onClick={mint} disabled={busy} data-action="mint-token">
            <KeyRoundIcon /> {t("connectAi.create")}
          </Button>
        ) : null}
      </header>
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <p className="grid-micro">{t("connectAi.endpoint")}</p>
          <CopyField value={url} />
        </div>
        {token ? (
          <div className="space-y-1.5">
            <p className="grid-micro">{t("connectAi.token")}</p>
            <CopyField value={token} />
            <p className="text-meta text-grid-warn-text">{t("mcp.shownOnce")}</p>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <p className="grid-micro">{t("connectAi.claudeCode")}</p>
          <pre dir="ltr" className="overflow-x-auto rounded-md border border-line bg-muted/40 p-3 text-xs">
            <code>{claudeCode}</code>
          </pre>
        </div>
        <div className="space-y-1.5">
          <p className="grid-micro">{t("connectAi.desktop")}</p>
          <pre dir="ltr" className="overflow-x-auto rounded-md border border-line bg-muted/40 p-3 text-xs">
            <code>{desktop}</code>
          </pre>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(desktop)
              toast.success(t("connectAi.copied"))
            }}
          >
            {t("connectAi.copyConfig")}
          </Button>
        </div>
        <p className="text-meta text-grid-muted">
          {t("connectAi.tools")}{" "}
          <Link href={`/${locale}/w/${ws.slug}/settings/mcp`} className="text-grid-action hover:underline">
            {t("connectAi.manage")}
          </Link>
        </p>
      </div>
    </section>
  )
}
