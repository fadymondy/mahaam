"use client"

import { useMemo, useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Badge, Button, DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { DataView } from "@/components/data-view"
import { Panel, SectionTitle } from "@/components/page"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState } from "@/components/states"
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

  const list = useMemo(() => tokens.data?.tokens ?? [], [tokens.data])
  const columns = useMemo<DataTableColumn<McpToken>[]>(
    () => [
      { id: "name", header: t("mcp.name"), hideable: false, sortValue: (tok) => tok.name.toLowerCase(), searchValue: (tok) => `${tok.name} ${tok.prefix} ${(tok.scopes ?? []).join(" ")}`, className: "font-medium", cell: (tok) => tok.name },
      {
        id: "prefix",
        header: t("mcp.prefix"),
        cell: (tok) => (
          <Ltr mono className="text-xs">
            {tok.prefix}…
          </Ltr>
        ),
      },
      {
        id: "scopes",
        header: t("mcp.scopes"),
        cell: (tok) => (
          <div className="flex max-w-xs flex-wrap gap-1">
            {(tok.scopes ?? []).map((s) => (
              <Badge key={s} variant="outline" className="font-mono" dir="ltr">
                {s}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "lastUsed",
        header: t("mcp.lastUsed"),
        sortValue: (tok) => tok.last_used_at ?? null,
        className: "text-muted-foreground",
        cell: (tok) => (tok.last_used_at ? <Ltr>{formatDate(tok.last_used_at)}</Ltr> : t("mcp.never")),
      },
      {
        id: "expires",
        header: t("mcp.expires"),
        sortValue: (tok) => tok.expires_at ?? null,
        className: "text-muted-foreground",
        cell: (tok) => (tok.expires_at ? <Ltr>{formatDate(tok.expires_at)}</Ltr> : t("mcp.noExpiry")),
      },
      {
        id: "status",
        header: t("mcp.status"),
        align: "end",
        hideable: false,
        filterValue: tokenState,
        cell: (tok) => {
          const state = tokenState(tok)
          if (state !== "active") return <Badge variant="neutral">{t(state === "revoked" ? "mcp.revokedBadge" : "mcp.expiredBadge")}</Badge>
          return (
            <ConfirmButton
              label={t("common.revoke")}
              title={t("mcp.revokeTitle")}
              description={t("mcp.revokeBody", { name: tok.name })}
              confirmLabel={t("common.revoke")}
              onConfirm={() => revoke(tok.id)}
            />
          )
        },
      },
    ],
    // revoke only closes over ws.id and tokens.mutate
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, formatDate],
  )
  const table = useDataTable({ data: list, columns, getRowId: (tok) => tok.id, pageSize: 25, defaultSort: { id: "lastUsed", direction: "desc" } })

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
      ) : (
        <DataView
          table={table}
          label={t("nav.mcpTokens")}
          rowLabel={(tok) => tok.name}
          loading={tokens.isLoading}
          empty={<EmptyState title={t("mcp.empty")} body={t("mcp.emptyBody")} />}
          search={t("mcp.search")}
          filters={
            <DataTableFacetFilter
              table={table}
              column="status"
              title={t("mcp.status")}
              options={[
                { value: "active", label: t("mcp.activeBadge") },
                { value: "expired", label: t("mcp.expiredBadge") },
                { value: "revoked", label: t("mcp.revokedBadge") },
              ]}
            />
          }
        />
      )}

      <Panel title={t("mcp.kitTitle")}>
        <AgentKitGuide />
      </Panel>

      <ConnectAgentDialog open={creating} onOpenChange={setCreating} onCreated={() => tokens.mutate()} />
    </div>
  )
}

function tokenState(tok: McpToken): "active" | "expired" | "revoked" {
  if (tok.revoked_at) return "revoked"
  return tok.expires_at && new Date(tok.expires_at).getTime() < Date.now() ? "expired" : "active"
}
