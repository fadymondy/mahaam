"use client"

// "Connect an AI agent": mint an MCP token and hand back ready-to-paste setup for whichever
// client the user runs — Claude Code, Claude Desktop, Cursor, or any other MCP client that
// speaks streamable-HTTP with a bearer header. Opened from the header (any workspace member who
// can hold a token) and from Settings → MCP tokens (the token list's "New token" button).
import { useState, type FormEvent } from "react"
import { CheckIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CopyField, Ltr } from "@/components/copy-field"
import { AgentKitGuide } from "@/components/mcp/agent-kit-guide"
import { LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api, ApiError, type McpToken } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useMcpTokens } from "@/lib/queries"
import { useProjects } from "@/lib/work"

export const MCP_ORIGIN = process.env.NEXT_PUBLIC_MCP_ORIGIN ?? "http://localhost:8110"

const EXPIRY = ["30", "90", "365", "never"] as const
// A broad default so "Connect" works without making someone read the scope list first; they can
// still mint a narrower token from Settings → MCP tokens.
const DEFAULT_SCOPES = ["projects:read", "tasks:read", "tasks:write", "issues:read", "issues:write", "time:read", "time:write"]

export function ConnectAgentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const tokens = useMcpTokens(open ? ws.id : null)
  const [name, setName] = useState("")
  const [chosen, setChosen] = useState<string[]>([])
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [expiry, setExpiry] = useState<string>("90")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const projects = useProjects(ws.id)

  // A customer sees only the scopes their role can hold; staff see the whole list (disallowed
  // ones greyed, so the hierarchy is visible when picking scopes for someone else's token).
  const scopes = (tokens.data?.scopes ?? []).filter((s) => s.allowed || ws.can("members:read"))
  const expiryItems = EXPIRY.map((v) => ({ value: v, label: v === "never" ? t("mcp.expiryNever") : t("mcp.expiryDays", { n: v }) }))

  function reset() {
    setName("")
    setChosen([])
    setProjectIds([])
    setExpiry("90")
    setError(null)
    setPlaintext(null)
    setAdvanced(false)
  }
  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) reset()
  }
  function toggle(scope: string, on: boolean) {
    setChosen((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const wanted = advanced ? chosen : scopes.filter((s) => s.allowed && DEFAULT_SCOPES.includes(s.scope)).map((s) => s.scope)
    if (wanted.length === 0) {
      setError(t("mcp.pickScope"))
      return
    }
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name: name.trim() || t("mcp.connectDefaultName"), scopes: wanted }
      if (expiry !== "never") body.expires_in_days = Number(expiry)
      if (advanced && projectIds.length > 0) body.projects = projectIds
      const res = await api<{ token: McpToken; plaintext: string }>("/api/w/mcp_tokens", { json: body, workspaceId: ws.id })
      setPlaintext(res.plaintext)
      onCreated?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {plaintext ? (
          <TokenSnippets plaintext={plaintext} onDone={() => handleOpenChange(false)} />
        ) : tokens.isLoading ? (
          <LoadingRows rows={3} />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("mcp.connectTitle")}</DialogTitle>
              <DialogDescription>{t("mcp.connectHint")}</DialogDescription>
            </DialogHeader>
            <details className="border border-line bg-grid-card p-3">
              <summary className="cursor-pointer text-sm font-medium text-grid-fg">{t("mcp.kitTitle")}</summary>
              <div className="pt-3">
                <AgentKitGuide />
              </div>
            </details>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ca-name">{t("mcp.name")}</FieldLabel>
                <Input id="ca-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mcp.connectDefaultName")} />
              </Field>

              {advanced ? (
                <FieldSet>
                  <FieldLegend variant="label">{t("mcp.scopes")}</FieldLegend>
                  <FieldDescription>{t("mcp.scopesHint")}</FieldDescription>
                  <ul className="max-h-64 divide-y divide-line overflow-y-auto border border-line">
                    {scopes.map((s) => {
                      const id = `ca-scope-${s.scope}`
                      return (
                        <li key={s.scope} className={s.allowed ? "" : "bg-grid-soft/50"}>
                          <label htmlFor={id} className={`flex items-start gap-3 px-3 py-2.5 ${s.allowed ? "cursor-pointer" : "cursor-not-allowed"}`}>
                            <input
                              id={id}
                              type="checkbox"
                              className="mt-0.5 size-4 shrink-0 accent-(--grid-action)"
                              disabled={!s.allowed}
                              checked={chosen.includes(s.scope)}
                              onChange={(e) => toggle(s.scope, e.target.checked)}
                            />
                            <span className="min-w-0">
                              <span dir="ltr" className="ltr-isolate block font-mono text-xs text-grid-fg">
                                {s.scope}
                              </span>
                              <span className="block text-sm text-grid-body">{s.description}</span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </FieldSet>
              ) : (
                <p className="text-sm text-grid-muted">
                  {t("mcp.connectDefaultScopeHint")}{" "}
                  <button type="button" className="text-grid-action hover:underline" onClick={() => setAdvanced(true)}>
                    {t("mcp.connectPickScopes")}
                  </button>
                </p>
              )}

              {advanced ? (
                <Field>
                  <FieldLabel>{t("mcp.projects")}</FieldLabel>
                  <FieldDescription>{t("mcp.projectsHint")}</FieldDescription>
                  <ul className="max-h-40 divide-y divide-line overflow-y-auto border border-line">
                    <li>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                        <input type="checkbox" className="size-4 shrink-0 accent-(--grid-action)" checked={projectIds.length === 0} onChange={() => setProjectIds([])} />
                        <span className="text-sm text-grid-fg">{t("mcp.allProjects")}</span>
                      </label>
                    </li>
                    {(projects.data?.projects ?? []).map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-(--grid-action)"
                            checked={projectIds.includes(p.id)}
                            onChange={(e) => setProjectIds((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                          />
                          <span className="truncate text-sm text-grid-body" dir="auto">
                            {p.name}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="ca-expiry">{t("mcp.expiry")}</FieldLabel>
                <Select items={expiryItems} value={expiry} onValueChange={(v) => setExpiry(String(v ?? "90"))}>
                  <SelectTrigger id="ca-expiry" className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expiryItems.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("common.working") : t("mcp.connectGo")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Ready-to-paste setup for the token just minted, one block per client. */
function TokenSnippets({ plaintext, onDone }: { plaintext: string; onDone: () => void }) {
  const { t } = useTranslations()
  const desktopConfig = JSON.stringify(
    { mcpServers: { mahaam: { url: `${MCP_ORIGIN}/api/mcp`, headers: { Authorization: `Bearer ${plaintext}` } } } },
    null,
    2,
  )
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("mcp.createdTitle")}</DialogTitle>
        <DialogDescription>{t("mcp.createdHint")}</DialogDescription>
      </DialogHeader>
      <p className="flex items-start gap-2 border border-line bg-grid-card p-3 text-sm text-grid-warn-text" role="alert">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
        {t("mcp.shownOnce")}
      </p>

      <div className="space-y-1.5">
        <p className="grid-micro">{t("mcp.token")}</p>
        <CopyField value={plaintext} label={t("mcp.token")} />
      </div>

      <div className="space-y-1.5">
        <p className="grid-micro">{t("mcp.claudeCode")}</p>
        <CopyField value={`claude mcp add --transport http mahaam ${MCP_ORIGIN}/api/mcp --header "Authorization: Bearer ${plaintext}"`} label={t("mcp.claudeCode")} />
      </div>

      <div className="space-y-1.5">
        <p className="grid-micro">{t("mcp.claudeDesktopCursor")}</p>
        <CopyField value={desktopConfig} label={t("mcp.claudeDesktopCursor")} />
        <p className="text-meta text-grid-muted">{t("mcp.claudeDesktopCursorHint")}</p>
      </div>

      <div className="space-y-1.5">
        <p className="grid-micro">{t("mcp.genericClient")}</p>
        <div className="space-y-1 text-meta text-grid-muted">
          <p>
            {t("mcp.serverUrl")}: <Ltr mono>{MCP_ORIGIN}/api/mcp</Ltr>
          </p>
          <p>
            {t("mcp.authHeader")}: <Ltr mono>Authorization: Bearer {"<token>"}</Ltr>
          </p>
        </div>
      </div>

      <p className="flex items-start gap-2 text-meta text-grid-muted">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        {t("mcp.oauthClientsHint")}
      </p>

      <DialogFooter>
        <Button onClick={onDone}>
          <CheckIcon />
          {t("mcp.savedIt")}
        </Button>
      </DialogFooter>
    </div>
  )
}
