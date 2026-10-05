"use client"

// "Connect an AI agent": mint an MCP token and hand back ready-to-paste setup for whichever
// client the user runs — Claude Code, Claude Desktop, Cursor, or any other MCP client that
// speaks streamable-HTTP with a bearer header. Opened from the header (any workspace member who
// can hold a token) and from Settings → MCP tokens (the token list's "New token" button).
import { useState, type FormEvent, type ReactNode } from "react"
import { CheckIcon, TriangleAlertIcon } from "lucide-react"

import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldDescription, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@fadymondy/nasaq/web"
import { FormError, FormHint } from "@/components/form-text"





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

/**
 * The token form on its own: name, scopes (a broad default unless "pick scopes"), projects and expiry.
 * The dialog and the header's connect side-over both mint through it.
 */
export function TokenForm({ onMinted, onCancel, header, kit = true }: { onMinted: (plaintext: string) => void; onCancel: () => void; header?: ReactNode; kit?: boolean }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const tokens = useMcpTokens(ws.id)
  const [name, setName] = useState("")
  const [chosen, setChosen] = useState<string[]>([])
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [expiry, setExpiry] = useState<string>("90")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const projects = useProjects(ws.id)

  // A customer sees only the scopes their role can hold; staff see the whole list (disallowed
  // ones greyed, so the hierarchy is visible when picking scopes for someone else's token).
  const scopes = (tokens.data?.scopes ?? []).filter((s) => s.allowed || ws.can("members:read"))
  const allowedScopes = scopes.filter((s) => s.allowed).map((s) => s.scope)
  // Scopes are "area:action"; one group per area, in first-seen order.
  const scopeGroups = [...Map.groupBy(scopes, (s) => s.scope.split(":")[0]).entries()]
  const projectList = projects.data?.projects ?? []
  const expiryItems = EXPIRY.map((v) => ({ value: v, label: v === "never" ? t("mcp.expiryNever") : t("mcp.expiryDays", { n: v }) }))

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
      onMinted(res.plaintext)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  if (tokens.isLoading) return <LoadingRows rows={3} />
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {header}
      {kit ? (
        <details className="border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">{t("mcp.kitTitle")}</summary>
          <div className="pt-3">
            <AgentKitGuide />
          </div>
        </details>
      ) : null}
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="ca-name">{t("mcp.name")}</FieldLabel>
          <Input id="ca-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("mcp.connectDefaultName")} />
        </Field>

        {advanced ? (
          <fieldset className="flex flex-col gap-2" data-scope-groups>
            <div className="flex items-center justify-between gap-2">
              <legend className="text-label font-medium">{t("mcp.scopes")}</legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={allowedScopes.length > 0 && chosen.length === allowedScopes.length}
                  indeterminate={chosen.length > 0 && chosen.length < allowedScopes.length}
                  onCheckedChange={(on) => setChosen(on ? allowedScopes : [])}
                />
                {t("mcp.selectAll")}
              </label>
            </div>
            <FormHint>{t("mcp.scopesHint")}</FormHint>
            <div className="max-h-80 divide-y divide-line overflow-y-auto border border-border">
              {scopeGroups.map(([group, items]) => {
                const pickable = items.filter((s) => s.allowed).map((s) => s.scope)
                const picked = pickable.filter((x) => chosen.includes(x)).length
                return (
                  <div key={group} data-scope-group={group}>
                    <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-3 bg-muted px-3 py-2">
                      <Checkbox
                        disabled={pickable.length === 0}
                        checked={pickable.length > 0 && picked === pickable.length}
                        indeterminate={picked > 0 && picked < pickable.length}
                        onCheckedChange={(on) => setChosen((prev) => (on ? [...new Set([...prev, ...pickable])] : prev.filter((x) => !pickable.includes(x))))}
                      />
                      <span dir="ltr" className="ltr-isolate flex-1 font-mono text-xs font-semibold text-foreground">
                        {group}
                      </span>
                      <span className="text-caption text-muted-foreground tabular-nums" dir="ltr">
                        {picked}/{pickable.length}
                      </span>
                    </label>
                    <ul className="divide-y divide-line">
                      {items.map((s) => (
                        <li key={s.scope} className={s.allowed ? "" : "bg-muted/50"}>
                          <label className={`flex items-start gap-3 py-2 ps-9 pe-3 ${s.allowed ? "cursor-pointer" : "cursor-not-allowed"}`}>
                            <Checkbox className="mt-0.5" disabled={!s.allowed} checked={chosen.includes(s.scope)} onCheckedChange={(on) => toggle(s.scope, on)} />
                            <span className="min-w-0">
                              <span dir="ltr" className="ltr-isolate block font-mono text-xs text-foreground">
                                {s.scope.slice(group.length + 1) || s.scope}
                              </span>
                              <span className="block text-sm text-nq-fg-body">{s.description}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("mcp.connectDefaultScopeHint")}{" "}
            <button type="button" className="text-nq-accent-text hover:underline" onClick={() => setAdvanced(true)}>
              {t("mcp.connectPickScopes")}
            </button>
          </p>
        )}

        {advanced ? (
          <Field>
            <FieldLabel>{t("mcp.projects")}</FieldLabel>
            <FieldDescription>{t("mcp.projectsHint")}</FieldDescription>
            <ul className="max-h-48 divide-y divide-line overflow-y-auto border border-border">
              <li className="sticky top-0 z-10 bg-muted">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <Checkbox checked={projectIds.length === 0} onCheckedChange={(on) => on && setProjectIds([])} />
                  <span className="flex-1 text-sm font-medium text-foreground">{t("mcp.allProjects")}</span>
                  <span className="text-caption text-muted-foreground">{t("mcp.allProjectsHint")}</span>
                </label>
              </li>
              {projectList.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2 ps-9 pe-3">
                    <Checkbox
                      checked={projectIds.length === 0 || projectIds.includes(p.id)}
                      onCheckedChange={(on) =>
                        setProjectIds((prev) => {
                          // From "all", unticking one keeps every other project.
                          const base = prev.length === 0 ? projectList.map((x) => x.id) : prev
                          const next = on ? [...base, p.id] : base.filter((x) => x !== p.id)
                          return next.length === projectList.length ? [] : next
                        })
                      }
                    />
                    <span className="truncate text-sm text-nq-fg-body" dir="auto">
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
        {error ? <FormError>{error}</FormError> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? t("common.working") : t("mcp.connectGo")}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ConnectAgentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { t } = useTranslations()
  const [plaintext, setPlaintext] = useState<string | null>(null)
  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setPlaintext(null)
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {plaintext ? (
          <TokenSnippets plaintext={plaintext} onDone={() => handleOpenChange(false)} />
        ) : open ? (
          <TokenForm
            onMinted={(p) => {
              setPlaintext(p)
              onCreated?.()
            }}
            onCancel={() => handleOpenChange(false)}
            header={
              <DialogHeader>
                <DialogTitle>{t("mcp.connectTitle")}</DialogTitle>
                <DialogDescription>{t("mcp.connectHint")}</DialogDescription>
              </DialogHeader>
            }
          />
        ) : null}
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
      <p className="flex items-start gap-2 border border-border bg-card p-3 text-sm text-nq-warn-text" role="alert">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
        {t("mcp.shownOnce")}
      </p>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.token")}</p>
        <CopyField value={plaintext} label={t("mcp.token")} />
      </div>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.claudeCode")}</p>
        <CopyField value={`claude mcp add --transport http mahaam ${MCP_ORIGIN}/api/mcp --header "Authorization: Bearer ${plaintext}"`} label={t("mcp.claudeCode")} />
      </div>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.claudeDesktopCursor")}</p>
        <CopyField value={desktopConfig} label={t("mcp.claudeDesktopCursor")} />
        <p className="text-caption text-muted-foreground">{t("mcp.claudeDesktopCursorHint")}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.genericClient")}</p>
        <div className="space-y-1 text-caption text-muted-foreground">
          <p>
            {t("mcp.serverUrl")}: <Ltr mono>{MCP_ORIGIN}/api/mcp</Ltr>
          </p>
          <p>
            {t("mcp.authHeader")}: <Ltr mono>Authorization: Bearer {"<token>"}</Ltr>
          </p>
        </div>
      </div>

      <p className="flex items-start gap-2 text-caption text-muted-foreground">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        {t("mcp.oauthClientsHint")}
      </p>

      <DialogFooter>
        <Button variant="primary" onClick={onDone}>
          <CheckIcon />
          {t("mcp.savedIt")}
        </Button>
      </DialogFooter>
    </div>
  )
}
