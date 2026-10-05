"use client"

// The MCP panel of the Connect side-over, written for people who have never heard of MCP: pick the
// app you use, follow two or three plain steps with one big button, then try a first question.
// Claude, ChatGPT and Claude Code sign in with OAuth (Mahaam's own consent screen), so they need
// only the link. Cursor, VS Code and "another app" take a token, minted right here.
import { useState, type ReactNode } from "react"
import { ArrowLeftIcon, CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon, MessageCircleIcon } from "lucide-react"
import { Alert, Button, mcpSnippet, type McpClientId } from "@fadymondy/nasaq/web"

import { TokenForm } from "@/components/mcp/connect-agent-dialog"
import { useTranslations } from "@/lib/i18n"
import { MCP_ORIGIN } from "@/lib/mcp-origin"
import { cn } from "@/lib/utils"

type App = "claude" | "chatgpt" | "claude-code" | "cursor" | "vscode" | "other"
// Brand marks live in public/apps. The monochrome ones (mono) flip in dark mode.
const APPS: { id: App; logo: string; mono?: boolean; token: boolean }[] = [
  { id: "claude", logo: "/apps/claude-color.svg", token: false },
  { id: "chatgpt", logo: "/apps/openai.svg", mono: true, token: false },
  { id: "claude-code", logo: "/apps/claudecode-color.svg", token: false },
  { id: "cursor", logo: "/apps/cursor.svg", mono: true, token: true },
  { id: "vscode", logo: "/apps/vscode.svg", token: true },
  { id: "other", logo: "/apps/mcp.svg", mono: true, token: true },
]

function AppLogo({ app, className }: { app: App; className?: string }) {
  const a = APPS.find((x) => x.id === app)!
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-xs", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={a.logo} alt="" className={cn("size-6", a.mono && "dark:invert")} />
    </span>
  )
}

/** A big copy button: says "Copied" for a moment so nobody wonders whether it worked. */
function CopyBig({ value, label }: { value: string; label: string }) {
  const { t } = useTranslations()
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="primary"
      className="w-full rounded-full sm:w-auto"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1800)
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
      {done ? t("connect.copied") : label}
    </Button>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col">
      {items.map((x, i) => (
        <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 ? <span aria-hidden className="absolute start-3.5 top-8 bottom-1 w-px bg-border" /> : null}
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums">
            {i + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1 text-body-sm text-foreground">{x}</div>
        </li>
      ))}
    </ol>
  )
}

/** The raw setup, tucked away for the people who want to see it. */
function ShowSetup({ code }: { code: string }) {
  const { t } = useTranslations()
  return (
    <details className="rounded-card border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-caption text-muted-foreground">{t("connect.showSetup")}</summary>
      <pre dir="ltr" className="overflow-x-auto border-t border-border px-3 py-2 font-mono text-xs text-foreground">
        {code}
      </pre>
    </details>
  )
}

export function ConnectSteps({ onClose }: { onClose: () => void }) {
  const { t } = useTranslations()
  const [app, setApp] = useState<App | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const url = `${MCP_ORIGIN}/api/mcp`
  const server = { name: "mahaam", url, token: token ?? undefined }

  if (!app) {
    return (
      <div className="flex flex-col gap-4" data-connect-pick>
        <div>
          <h3 className="text-h4 text-foreground">{t("connect.pickTitle")}</h3>
          <p className="text-body-sm text-muted-foreground">{t("connect.pickHint")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {APPS.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setApp(a.id)}
              className="group flex flex-col items-start gap-2 rounded-card border border-border bg-card p-4 text-start outline-none transition-all duration-200 hover:border-primary hover:bg-nq-hover hover:shadow-md focus-visible:outline-2 focus-visible:outline-nq-focus motion-safe:hover:-translate-y-0.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 fill-mode-both"
              style={{ animationDelay: `${i * 40}ms` }}
              data-connect-app={a.id}
            >
              <AppLogo app={a.id} className="transition-transform duration-200 motion-safe:group-hover:scale-110" />
              <span className="text-label text-foreground">{t(`connect.app.${a.id}`)}</span>
              <span className="text-caption text-muted-foreground">{t(`connect.app.${a.id}.hint`)}</span>
            </button>
          ))}
        </div>
        <TryIt />
      </div>
    )
  }

  const needsToken = APPS.find((a) => a.id === app)!.token
  const back = (
    <Button variant="ghost" size="sm" className="self-start rounded-full" onClick={() => (setApp(null), setToken(null))}>
      <ArrowLeftIcon className="rtl:-scale-x-100" />
      {t("connect.otherApp")}
    </Button>
  )
  const title = (
    <div className="flex items-center gap-3">
      <AppLogo app={app} />
      <h3 className="text-h4 text-foreground">{t("connect.setupTitle", { app: t(`connect.app.${app}`) })}</h3>
    </div>
  )

  if (needsToken && !token) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {title}
        <Alert tone="info">
          <span className="flex items-start gap-2">
            <KeyRoundIcon className="mt-0.5 size-4 shrink-0" />
            {t("connect.keyFirst")}
          </span>
        </Alert>
        <TokenForm kit={false} onMinted={setToken} onCancel={onClose} />
      </div>
    )
  }

  let steps: ReactNode[]
  switch (app) {
    case "claude":
      steps = [
        <>
          {t("connect.claude.1")}
          <CopyBig value={url} label={t("connect.copyLink")} />
        </>,
        t("connect.claude.2"),
        t("connect.claude.3"),
      ]
      break
    case "chatgpt":
      steps = [
        <>
          {t("connect.chatgpt.1")}
          <CopyBig value={url} label={t("connect.copyLink")} />
        </>,
        t("connect.chatgpt.2"),
        t("connect.chatgpt.3"),
      ]
      break
    case "claude-code": {
      const cmd = `claude mcp add --transport http mahaam ${url}`
      steps = [
        <>
          {t("connect.code.1")}
          <CopyBig value={cmd} label={t("connect.copyCommand")} />
          <ShowSetup code={cmd} />
        </>,
        t("connect.code.2"),
      ]
      break
    }
    case "cursor":
    case "vscode": {
      const sn = mcpSnippet(app as McpClientId, server)
      steps = [
        <>
          {t(`connect.${app}.1`)}
          {sn.deepLink ? (
            <Button variant="primary" className="w-full rounded-full sm:w-auto" nativeButton={false} render={<a href={sn.deepLink} />}>
              <ExternalLinkIcon />
              {t(`connect.${app}.button`)}
            </Button>
          ) : null}
          <ShowSetup code={sn.code} />
        </>,
        t(`connect.${app}.2`),
      ]
      break
    }
    default:
      steps = [
        <>
          {t("connect.other.1")}
          <CopyBig value={url} label={t("connect.copyLink")} />
        </>,
        <>
          {t("connect.other.2")}
          <CopyBig value={`Bearer ${token}`} label={t("connect.copyKey")} />
        </>,
      ]
  }

  return (
    <div className="flex flex-col gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-end-2" data-connect-setup={app}>
      {back}
      {title}
      {token ? <Alert tone="warning">{t("connect.keyOnce")}</Alert> : null}
      <div className="rounded-card border border-border bg-card p-4">
        <Steps items={steps} />
      </div>
      <TryIt />
    </div>
  )
}

function TryIt() {
  const { t } = useTranslations()
  return (
    <div className="flex items-start gap-3 rounded-card bg-muted p-4">
      <MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-nq-accent-text" />
      <div className="text-body-sm">
        <p className="font-medium text-foreground">{t("connect.tryTitle")}</p>
        <p className={cn("text-muted-foreground")}>{t("connect.tryHint")}</p>
      </div>
    </div>
  )
}
