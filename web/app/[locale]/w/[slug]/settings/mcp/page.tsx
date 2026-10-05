"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { Panel, SectionTitle } from "@/components/page"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ConnectAgentDialog } from "@/components/mcp/connect-agent-dialog"
import { AgentKitGuide } from "@/components/mcp/agent-kit-guide"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api, ApiError, type McpScope, type McpToken } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useMcpTokens } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

import { MCP_ORIGIN } from "@/lib/mcp-origin"

export default function McpTokensPage() {
  const { t, formatDate } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.mcpTokens")} · ${ws.summary.name}`)
  const tokens = useMcpTokens(ws.id)
  const [creating, setCreating] = useState(false)

  async function revoke(id: string) {
    try {
      await api(`/api/w/mcp_tokens/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws.id })
      toast.success(t("mcp.revoked"))
      await tokens.mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    }
  }

  const list = tokens.data?.tokens ?? []

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        title={t("nav.mcpTokens")}
        description={t("mcp.hint")}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!tokens.data}>
            <PlusIcon />
            {t("mcp.create")}
          </Button>
        }
      />

      {tokens.error ? (
        <ErrorState error={tokens.error} />
      ) : tokens.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("mcp.empty")} body={t("mcp.emptyBody")} />
      ) : (
        <Panel flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-4">{t("mcp.name")}</TableHead>
                <TableHead>{t("mcp.prefix")}</TableHead>
                <TableHead>{t("mcp.scopes")}</TableHead>
                <TableHead>{t("mcp.lastUsed")}</TableHead>
                <TableHead>{t("mcp.expires")}</TableHead>
                <TableHead className="pe-4 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((tok) => (
                <TokenRow key={tok.id} tok={tok} formatDate={formatDate} onRevoke={() => revoke(tok.id)} />
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      <Panel title={t("mcp.kitTitle")}>
        <AgentKitGuide />
      </Panel>

      <ConnectAgentDialog open={creating} onOpenChange={setCreating} onCreated={() => tokens.mutate()} />
    </div>
  )
}

function TokenRow({ tok, formatDate, onRevoke }: { tok: McpToken; formatDate: (v: string | null | undefined) => string; onRevoke: () => Promise<void> }) {
  const { t } = useTranslations()
  const expired = !!tok.expires_at && new Date(tok.expires_at).getTime() < Date.now()
  return (
    <TableRow className={tok.revoked_at || expired ? "opacity-60" : undefined}>
      <TableCell className="ps-4 font-medium">{tok.name}</TableCell>
      <TableCell>
        <Ltr mono className="text-xs">
          {tok.prefix}…
        </Ltr>
      </TableCell>
      <TableCell>
        <div className="flex max-w-xs flex-wrap gap-1">
          {(tok.scopes ?? []).map((s) => (
            <Badge key={s} variant="outline" className="font-mono" dir="ltr">
              {s}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{tok.last_used_at ? <Ltr>{formatDate(tok.last_used_at)}</Ltr> : t("mcp.never")}</TableCell>
      <TableCell className="text-muted-foreground">
        {tok.expires_at ? <Ltr>{formatDate(tok.expires_at)}</Ltr> : t("mcp.noExpiry")}
      </TableCell>
      <TableCell className="pe-4 text-end">
        {tok.revoked_at ? (
          <Badge variant="neutral">{t("mcp.revokedBadge")}</Badge>
        ) : expired ? (
          <Badge variant="neutral">{t("mcp.expiredBadge")}</Badge>
        ) : (
          <ConfirmButton
            label={t("common.revoke")}
            title={t("mcp.revokeTitle")}
            description={t("mcp.revokeBody", { name: tok.name })}
            confirmLabel={t("common.revoke")}
            onConfirm={onRevoke}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

