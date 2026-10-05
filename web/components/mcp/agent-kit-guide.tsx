"use client"

// Setup steps for the Mahaam AI kit (github.com/fadymondy/mahaam-plugin): the Claude Code plugin,
// a ChatGPT connector and Codex. All three connect over OAuth or an env token, so none of them
// needs the token pasted into a config file.
import { ExternalLinkIcon } from "lucide-react"

import { CopyField, Ltr } from "@/components/copy-field"
import { MCP_ORIGIN } from "@/lib/mcp-origin"
import { useTranslations } from "@/lib/i18n"


export const PLUGIN_REPO = "https://github.com/fadymondy/mahaam-plugin"

export function AgentKitGuide() {
  const { t } = useTranslations()
  const url = `${MCP_ORIGIN}/api/mcp`
  const codex = `[mcp_servers.mahaam]\nurl = "${url}"\nbearer_token_env_var = "MAHAAM_TOKEN"`
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-nq-fg-body">
        {t("mcp.kitHint")}{" "}
        <a href={PLUGIN_REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nq-accent-text hover:underline">
          <Ltr mono>fadymondy/mahaam-plugin</Ltr>
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </p>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.kitClaude")}</p>
        <CopyField value={"/plugin marketplace add fadymondy/mahaam-plugin\n/plugin install mahaam@mahaam"} label={t("mcp.kitClaude")} />
        <p className="text-caption text-muted-foreground">{t("mcp.kitClaudeHint")}</p>
        {MCP_ORIGIN !== "https://console.mahaam.app" ? (
          <p className="text-caption text-muted-foreground">
            {t("mcp.kitSelfHosted")} <Ltr mono>MAHAAM_URL={MCP_ORIGIN}</Ltr>
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.kitChatgpt")}</p>
        <CopyField value={url} label={t("mcp.serverUrl")} />
        <p className="text-caption text-muted-foreground">{t("mcp.kitChatgptHint")}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-eyebrow uppercase">{t("mcp.kitCodex")}</p>
        <CopyField value={codex} label={t("mcp.kitCodex")} />
        <p className="text-caption text-muted-foreground">{t("mcp.kitCodexHint")}</p>
      </div>
    </div>
  )
}
