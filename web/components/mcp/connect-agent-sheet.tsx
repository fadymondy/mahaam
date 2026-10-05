"use client"

// "Connect your agent" as a side-over, opened from the header's green Connect button. The connection
// types sit as tiles across the top (MCP, Agent kit, API), the way Supabase's Connect panel does.
// MCP mints a token in place, then hands it to Nasaq's McpConnect for per-client setup.
// TODO(MH-1094): once nasaq#18 ships (McpConnectSheet, ConnectButton, McpConnect layout="steps"),
// swap the local frame below for those.
import { useState, type ReactNode } from "react"
import { BookOpenIcon, CodeIcon, PlugIcon, SparklesIcon } from "lucide-react"
import { Button, McpConnect, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@fadymondy/nasaq/web"

import { CopyField } from "@/components/copy-field"
import { AgentKitGuide } from "@/components/mcp/agent-kit-guide"
import { MCP_ORIGIN, TokenForm } from "@/components/mcp/connect-agent-dialog"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The header's call to action: a green pill with a plug. */
export function ConnectAgentButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslations()
  return (
    <Button
      size="sm"
      onClick={onClick}
      aria-label={t("mcp.connectTitle")}
      className="rounded-full border border-nq-success/40 bg-nq-success px-3.5 text-white shadow-sm hover:bg-[color-mix(in_oklab,var(--nq-success)_86%,black)]"
      data-connect-agent
    >
      <PlugIcon />
      <span className="hidden sm:inline">{t("mcp.connectShort")}</span>
    </Button>
  )
}

type Kind = "mcp" | "kit" | "api"

export function ConnectAgentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslations()
  const [kind, setKind] = useState<Kind>("mcp")
  const [plaintext, setPlaintext] = useState<string | null>(null)

  function change(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setPlaintext(null)
      setKind("mcp")
    }
  }

  const types: { value: Kind; label: string; description: string; icon: ReactNode }[] = [
    { value: "mcp", label: t("mcp.typeMcp"), description: t("mcp.typeMcpHint"), icon: <SparklesIcon /> },
    { value: "kit", label: t("mcp.typeKit"), description: t("mcp.typeKitHint"), icon: <BookOpenIcon /> },
    { value: "api", label: t("mcp.typeApi"), description: t("mcp.typeApiHint"), icon: <CodeIcon /> },
  ]

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent className="w-[min(44rem,100vw)]" data-connect-sheet>
        <SheetHeader>
          <SheetTitle className="text-h3">{t("mcp.connectTitle")}</SheetTitle>
          <SheetDescription>{t("mcp.connectSheetHint")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col">
          <div className="border-b border-border p-4">
            <div role="radiogroup" aria-label={t("mcp.connectType")} className="grid grid-cols-3 overflow-hidden rounded-card border border-border">
              {types.map((x) => {
                const on = x.value === kind
                return (
                  <button
                    key={x.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKind(x.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 border-e border-border px-2 py-3 text-center outline-none transition-colors last:border-e-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nq-focus [&_svg]:size-4",
                      on ? "bg-nq-selected text-foreground" : "text-muted-foreground hover:bg-nq-hover hover:text-foreground",
                    )}
                    data-connect-type={x.value}
                  >
                    {x.icon}
                    <span className="text-label">{x.label}</span>
                    <span className="text-caption text-muted-foreground">{x.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="p-4">
            {kind === "mcp" ? (
              plaintext ? (
                <McpConnect serverName="mahaam" serverUrl={`${MCP_ORIGIN}/api/mcp`} token={plaintext} className="max-w-none border-0 p-0 shadow-none" />
              ) : open ? (
                <TokenForm kit={false} onMinted={setPlaintext} onCancel={() => change(false)} />
              ) : null
            ) : kind === "kit" ? (
              <AgentKitGuide />
            ) : (
              <ApiPanel />
            )}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function ApiPanel() {
  const { t } = useTranslations()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-nq-fg-body">{t("mcp.apiHint")}</p>
      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">REST</p>
        <CopyField value={`${MCP_ORIGIN}/api`} label="REST" />
      </div>
      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">GraphQL</p>
        <CopyField value={`${MCP_ORIGIN}/graphql`} label="GraphQL" />
      </div>
      <div>
        <Button variant="secondary" size="sm" nativeButton={false} render={<a href={`${MCP_ORIGIN}/docs`} target="_blank" rel="noreferrer" />}>
          <BookOpenIcon />
          {t("mcp.apiDocs")}
        </Button>
      </div>
    </div>
  )
}
