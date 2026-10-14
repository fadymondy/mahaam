// Settings → AI agents: connect Mahaam to Claude, ChatGPT, Cursor… over MCP. The server URL for this
// workspace's server, per-agent setup with copy buttons, and the person's MCP tokens (mint with
// scopes — shown once — list, revoke). Remote connectors (claude.ai, ChatGPT) sign in with OAuth and
// need no token; local clients take a Bearer token. Web counterpart: components/mcp/connect-agent-dialog.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, CopyIcon, KeyRoundIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import type { McpToken, McpTokenInput } from "../../../main/api-agents";
import { LtrText, Spinner } from "@/components/kit";
import { Badge, Group, Row, Section, SmallButton } from "@/components/settings/parts";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useApp } from "@/lib/app";
import { api, ApiError } from "@/lib/bridge";
import { useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { nativeConfirm, nativeMenu } from "@/lib/native";
import { cn } from "@/lib/utils";

// The web dialog's broad default (and the server's default OAuth scopes, internal/mcp/oauth.go).
const DEFAULT_SCOPES = ["projects:read", "tasks:read", "tasks:write", "issues:read", "issues:write", "time:read", "time:write"];
const EXPIRY = ["30", "90", "365", "never"] as const;
const AGENTS = ["claude-code", "claude-ai", "chatgpt", "cursor", "vscode", "windsurf", "codex", "gemini", "other"] as const;
type Agent = (typeof AGENTS)[number];
const TOKEN_PLACEHOLDER = "<YOUR_MCP_TOKEN>";

function errText(err: unknown, t: (k: string) => string) {
  if (err instanceof ApiError) {
    if (err.status === 402) return `${t("agents.planLimit")} ${err.message ? `(${err.message})` : ""}`.trim();
    if (err.status === 403) return t("agents.forbidden");
    return err.message || t("common.error");
  }
  return err instanceof Error && err.message ? err.message : t("common.error");
}

function copy(text: string, done: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(done));
}

export function AgentsSettings() {
  const { t } = useI18n();
  const { ws, workspace } = useApp();
  const server = useQuery({ queryKey: ["w", ws, "mcp-server"], queryFn: () => api.mcpServer(), enabled: !!ws, staleTime: 10 * 60_000 });
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const url = server.data?.url ?? "";

  return (
    <Section id="agents" title={t("settings.agents")} description={t("agents.hint", { workspace: workspace?.name ?? "" })}>
      <Group title={t("agents.server")} footer={server.data?.oauth ? t("agents.oauthHint") : t("agents.tokenHint")}>
        <Row label={t("agents.serverUrl")} hint={server.isLoading ? <Spinner /> : <LtrText className="font-mono break-all">{url}</LtrText>} data-row="mcp-url">
          <SmallButton disabled={!url} onClick={() => copy(url, t("common.copied"))} data-copy="mcp-url">
            <CopyIcon />
            {t("common.copy")}
          </SmallButton>
        </Row>
        <Row label={t("agents.authHeader")} hint={<LtrText className="font-mono">Authorization: Bearer {plaintext ? `${plaintext.slice(0, 8)}…` : TOKEN_PLACEHOLDER}</LtrText>} />
      </Group>

      <Tokens onCreated={setPlaintext} plaintext={plaintext} onDismiss={() => setPlaintext(null)} />

      {url ? <Setup url={url} token={plaintext} oauth={!!server.data?.oauth} /> : null}
    </Section>
  );
}

// ── per-agent setup ──

function Setup({ url, token, oauth }: { url: string; token: string | null; oauth: boolean }) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<Agent>("claude-code");
  const tok = token ?? TOKEN_PLACEHOLDER;
  const bearer = `Bearer ${tok}`;
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  const blocks: Record<Agent, { steps: string[]; code?: { label: string; text: string }[] }> = {
    "claude-code": {
      steps: [t("agents.claudeCode.step")],
      code: [{ label: t("agents.command"), text: `claude mcp add --transport http mahaam ${url} --header "Authorization: ${bearer}"` }],
    },
    "claude-ai": {
      steps: oauth ? [t("agents.claudeAi.step1"), t("agents.claudeAi.step2"), t("agents.claudeAi.step3")] : [t("agents.noOauth")],
      code: [
        { label: t("agents.connectorUrl"), text: url },
        { label: t("agents.claudeDesktopJson"), text: json({ mcpServers: { mahaam: { url, headers: { Authorization: bearer } } } }) },
      ],
    },
    chatgpt: {
      steps: oauth ? [t("agents.chatgpt.step1"), t("agents.chatgpt.step2"), t("agents.chatgpt.step3")] : [t("agents.noOauth")],
      code: [{ label: t("agents.connectorUrl"), text: url }],
    },
    cursor: {
      steps: [t("agents.cursor.step")],
      code: [{ label: "~/.cursor/mcp.json", text: json({ mcpServers: { mahaam: { url, headers: { Authorization: bearer } } } }) }],
    },
    vscode: {
      steps: [t("agents.vscode.step")],
      code: [
        { label: ".vscode/mcp.json", text: json({ servers: { mahaam: { type: "http", url, headers: { Authorization: bearer } } } }) },
        { label: t("agents.command"), text: `code --add-mcp '${JSON.stringify({ name: "mahaam", type: "http", url, headers: { Authorization: bearer } })}'` },
      ],
    },
    windsurf: {
      steps: [t("agents.windsurf.step")],
      code: [{ label: "~/.codeium/windsurf/mcp_config.json", text: json({ mcpServers: { mahaam: { serverUrl: url, headers: { Authorization: bearer } } } }) }],
    },
    codex: {
      steps: [t("agents.codex.step1"), t("agents.codex.step2")],
      code: [
        { label: t("agents.envVar"), text: `export MAHAAM_MCP_TOKEN="${tok}"` },
        { label: t("agents.command"), text: `codex mcp add mahaam --url ${url} --bearer-token-env-var MAHAAM_MCP_TOKEN` },
        { label: "~/.codex/config.toml", text: `[mcp_servers.mahaam]\nurl = "${url}"\nbearer_token_env_var = "MAHAAM_MCP_TOKEN"` },
      ],
    },
    gemini: {
      steps: [t("agents.gemini.step")],
      code: [
        { label: t("agents.command"), text: `gemini mcp add --transport http mahaam ${url} --header "Authorization: ${bearer}"` },
        { label: "~/.gemini/settings.json", text: json({ mcpServers: { mahaam: { httpUrl: url, headers: { Authorization: bearer } } } }) },
      ],
    },
    other: {
      steps: [t("agents.other.step")],
      code: [
        { label: t("agents.serverUrl"), text: url },
        { label: t("agents.authHeader"), text: `Authorization: ${bearer}` },
      ],
    },
  };
  const needsToken = agent !== "chatgpt" && !(agent === "claude-ai" && oauth);
  const b = blocks[agent];

  return (
    <Group
      title={t("agents.connect")}
      action={
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-background px-2.5 text-[13px] hover:bg-grid-soft [&_svg]:size-3.5"
          onClick={async (e) => {
            const id = await nativeMenu(
              AGENTS.map((a) => ({ id: a, label: t(`agents.agent.${a}`), type: "radio" as const, checked: a === agent })),
              e.currentTarget,
            );
            if (id) setAgent(id as Agent);
          }}
          data-agent-picker={agent}
        >
          {t(`agents.agent.${agent}`)}
          <ChevronDownIcon className="text-grid-muted" />
        </button>
      }
      footer={needsToken && !token ? t("agents.needToken") : undefined}
    >
      <div className="flex flex-col gap-3 px-4 py-3" data-agent-setup={agent}>
        <div className="flex flex-wrap items-center gap-2">
          {needsToken ? <Badge tone={token ? "ok" : "warn"}>{t("agents.usesToken")}</Badge> : <Badge tone="action">{t("agents.usesOauth")}</Badge>}
        </div>
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-[13px] text-grid-body">
          {b.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {b.code?.map((c) => (
          <CodeBlock key={c.label} label={c.label} text={c.text} />
        ))}
      </div>
    </Group>
  );
}

function CodeBlock({ label, text }: { label: string; text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-grid-muted" dir="auto">
          {label}
        </span>
        <SmallButton
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
          }
          data-copy-code
        >
          {done ? <CheckIcon /> : <CopyIcon />}
          {done ? t("common.copied") : t("common.copy")}
        </SmallButton>
      </div>
      <pre dir="ltr" className="overflow-x-auto rounded-md border border-line bg-grid-soft/60 px-3 py-2 text-start font-mono text-[12px] leading-relaxed whitespace-pre text-grid-fg select-text">
        {text}
      </pre>
    </div>
  );
}

// ── tokens ──

function Tokens({ plaintext, onCreated, onDismiss }: { plaintext: string | null; onCreated: (p: string) => void; onDismiss: () => void }) {
  const { t, date } = useI18n();
  const { ws } = useApp();
  const qc = useQueryClient();
  const key = ["w", ws, "mcp-tokens"];
  const q = useQuery({ queryKey: key, queryFn: () => api.mcpTokens(), enabled: !!ws });
  const [creating, setCreating] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeMcpToken(id),
    onSuccess: () => {
      toast.success(t("agents.revoked"));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errText(err, t)),
  });

  async function askRevoke(tok: McpToken) {
    const ok = await nativeConfirm({ message: t("agents.revokeTitle"), detail: t("agents.revokeBody", { name: tok.name }), confirm: t("agents.revoke"), cancel: t("common.cancel"), destructive: true });
    if (ok) revoke.mutate(tok.id);
  }

  const list = q.data?.tokens ?? [];
  const active = list.filter((x) => !x.revoked_at);

  return (
    <>
      {plaintext ? (
        <Group title={t("agents.createdTitle")} footer={t("agents.createdHint")}>
          <div className="flex flex-col gap-2 px-4 py-3" data-token-plaintext>
            <p className="flex items-start gap-2 text-[13px] text-grid-warn-text" role="alert">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {t("agents.shownOnce")}
            </p>
            <CodeBlock label={t("agents.token")} text={plaintext} />
            <div className="flex justify-end">
              <SmallButton tone="primary" onClick={onDismiss}>
                <CheckIcon />
                {t("agents.savedIt")}
              </SmallButton>
            </div>
          </div>
        </Group>
      ) : null}

      <Group
        title={t("agents.tokens")}
        action={
          !creating ? (
            <SmallButton onClick={() => setCreating(true)} disabled={!q.data} data-create-token>
              <PlusIcon />
              {t("agents.create")}
            </SmallButton>
          ) : undefined
        }
        footer={t("agents.tokensHint")}
      >
        {creating && q.data ? (
          <CreateForm
            scopes={q.data.scopes}
            onCancel={() => setCreating(false)}
            onCreated={(p) => {
              setCreating(false);
              onCreated(p);
              void qc.invalidateQueries({ queryKey: key });
            }}
          />
        ) : null}
        {q.error ? (
          <Row label={errText(q.error, t)} />
        ) : !q.data ? (
          <Row label={<Spinner />} />
        ) : active.length === 0 && !creating ? (
          <Row label={t("agents.empty")} hint={t("agents.emptyBody")} icon={<KeyRoundIcon className="size-4" />} />
        ) : (
          active.map((tok) => {
            const expired = !!tok.expires_at && Date.parse(tok.expires_at) < Date.now();
            return (
              <Row
                key={tok.id}
                data-row="mcp-token"
                className={cn(expired && "opacity-60")}
                label={
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium" dir="auto">
                      {tok.name}
                    </span>
                    <LtrText className="font-mono text-[12px] text-grid-muted">{tok.prefix}…</LtrText>
                    {expired ? <Badge>{t("agents.expired")}</Badge> : null}
                  </span>
                }
                hint={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap gap-1">
                      {(tok.scopes ?? []).map((s) => (
                        <LtrText key={s} className="rounded-[4px] bg-grid-soft px-1 font-mono text-[11px]">
                          {s}
                        </LtrText>
                      ))}
                    </span>
                    <span>
                      {t("agents.lastUsed")}: {tok.last_used_at ? date(tok.last_used_at, { day: "numeric", month: "short", year: "numeric" }) : t("agents.never")}
                      {" · "}
                      {t("agents.expires")}: {tok.expires_at ? date(tok.expires_at, { day: "numeric", month: "short", year: "numeric" }) : t("agents.noExpiry")}
                      {tok.project_ids?.length ? ` · ${t("agents.projectCount", { n: tok.project_ids.length })}` : ""}
                    </span>
                  </span>
                }
              >
                {!expired ? (
                  <SmallButton tone="danger" onClick={() => void askRevoke(tok)} disabled={revoke.isPending} data-revoke={tok.id}>
                    {t("agents.revoke")}
                  </SmallButton>
                ) : null}
              </Row>
            );
          })
        )}
      </Group>
    </>
  );
}

function CreateForm({ scopes, onCancel, onCreated }: { scopes: { scope: string; description: string; min_role: string; allowed: boolean }[]; onCancel: () => void; onCreated: (plaintext: string) => void }) {
  const { t } = useI18n();
  const { workspace } = useApp();
  const projects = useProjects();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>("90");
  const [advanced, setAdvanced] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A customer sees only what their role can hold; staff see everything (disallowed greyed).
  const visible = scopes.filter((s) => s.allowed || workspace?.role !== "client");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const wanted = advanced ? chosen : scopes.filter((s) => s.allowed && DEFAULT_SCOPES.includes(s.scope)).map((s) => s.scope);
    if (!wanted.length) return setError(t("agents.pickScope"));
    const body: McpTokenInput = { name: name.trim() || t("agents.defaultName"), scopes: wanted };
    if (expiry !== "never") body.expires_in_days = Number(expiry);
    if (advanced && projectIds.length) body.projects = projectIds;
    setBusy(true);
    try {
      const out = await api.createMcpToken(body);
      onCreated(out.plaintext);
    } catch (err) {
      setError(errText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-3" data-token-form>
      <Field label={t("agents.name")}>
        <Input dir="auto" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("agents.namePlaceholder")} />
      </Field>
      <Field label={t("agents.expiry")}>
        <div role="radiogroup" aria-label={t("agents.expiry")} className="seg w-fit">
          {EXPIRY.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={expiry === v} onClick={() => setExpiry(v)} className="seg-item">
              {v === "never" ? t("agents.expiryNever") : t("agents.expiryDays", { n: v })}
            </button>
          ))}
        </div>
      </Field>
      {!advanced ? (
        <p className="text-[12.5px] text-grid-muted">
          {t("agents.defaultScopeHint")}{" "}
          <button type="button" className="text-grid-action hover:underline" onClick={() => setAdvanced(true)}>
            {t("agents.pickScopes")}
          </button>
        </p>
      ) : (
        <>
          <Field label={t("agents.scopes")} hint={t("agents.scopesHint")}>
            <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {visible.map((s) => (
                <li key={s.scope} className={cn(!s.allowed && "bg-grid-soft/50")}>
                  <label className={cn("flex items-start gap-3 px-3 py-2", s.allowed ? "cursor-pointer" : "cursor-not-allowed")}>
                    <Checkbox
                      className="mt-0.5"
                      disabled={!s.allowed}
                      checked={chosen.includes(s.scope)}
                      onCheckedChange={(on) => setChosen((p) => (on ? [...p, s.scope] : p.filter((x) => x !== s.scope)))}
                    />
                    <span className="min-w-0">
                      <LtrText className="block font-mono text-[12px] text-grid-fg">{s.scope}</LtrText>
                      <span className="block text-[12.5px] text-grid-muted">{s.description}</span>
                      {!s.allowed ? <span className="block text-[12px] text-grid-muted">{t("agents.notAllowed", { role: t(`role.${s.min_role}`) })}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Field>
          <Field label={t("agents.projects")} hint={t("agents.projectsHint")}>
            <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-md border border-line">
              <li>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px]">
                  <Checkbox checked={projectIds.length === 0} onCheckedChange={() => setProjectIds([])} />
                  {t("agents.allProjects")}
                </label>
              </li>
              {(projects.data ?? []).map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px]">
                    <Checkbox checked={projectIds.includes(p.id)} onCheckedChange={(on) => setProjectIds((prev) => (on ? [...prev, p.id] : prev.filter((x) => x !== p.id)))} />
                    <span className="truncate" dir="auto">
                      {p.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Field>
        </>
      )}
      {error ? <p className="text-[12.5px] text-grid-danger">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <SmallButton onClick={onCancel}>{t("common.cancel")}</SmallButton>
        <SmallButton type="submit" tone="primary" disabled={busy}>
          {busy ? <Spinner /> : null}
          {t("agents.createGo")}
        </SmallButton>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-grid-fg">{label}</span>
      {hint ? <span className="-mt-1 text-[12px] text-grid-muted">{hint}</span> : null}
      {children}
    </div>
  );
}
