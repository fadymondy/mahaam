"use client"

// "Connect your agent" as a side-over, opened from the header's green Connect button. The connection
// types sit as tiles across the top (MCP, Agent kit, API), the way Supabase's Connect panel does.
// MCP is ConnectSteps: pick your app, then plain steps with one big button.
// TODO(MH-1094): once nasaq#18 ships (McpConnectSheet, ConnectButton, McpConnect layout="steps"),
// swap the local frame below for those.
import { useState, type ReactNode } from "react"
import { BookOpenIcon, CodeIcon, PlugIcon, SparklesIcon } from "lucide-react"
import { Button, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@fadymondy/nasaq/web"

import { CopyField } from "@/components/copy-field"
import { AgentKitGuide } from "@/components/mcp/agent-kit-guide"
import { ConnectSteps } from "@/components/mcp/connect-steps"
import { MCP_ORIGIN } from "@/lib/mcp-origin"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The header's call to action: a pill with a plug, in the app's primary colour. */
export function ConnectAgentButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslations()
  return (
    <Button
      variant="primary"
      size="sm"
      onClick={onClick}
      aria-label={t("mcp.connectTitle")}
      className="group relative overflow-hidden rounded-full px-3.5 shadow-sm shadow-primary/30 transition-all duration-200 hover:shadow-md hover:shadow-primary/40 motion-safe:hover:-translate-y-px"
      data-connect-agent
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent motion-safe:animate-[connect-sheen_4s_ease-in-out_infinite] motion-reduce:hidden"
      />
      <PlugIcon className="transition-transform duration-300 motion-safe:group-hover:rotate-45" />
      <span className="hidden sm:inline">{t("mcp.connectShort")}</span>
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-white/70 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-white" />
      </span>
    </Button>
  )
}

type Kind = "mcp" | "kit" | "api"

export function ConnectAgentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslations()
  const [kind, setKind] = useState<Kind>("mcp")

  function change(next: boolean) {
    onOpenChange(next)
    if (!next) {
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
                      "flex flex-col items-center gap-1 border-e [&_svg]:transition-transform hover:[&_svg]:scale-110 border-border px-2 py-3 text-center outline-none transition-colors last:border-e-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-nq-focus [&_svg]:size-4",
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
          <div key={kind} className="p-4 motion-safe:animate-in motion-safe:fade-in">
            {kind === "mcp" ? (
              open ? <ConnectSteps onClose={() => change(false)} /> : null
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
