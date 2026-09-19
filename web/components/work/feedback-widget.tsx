"use client"

import { useMemo, useState } from "react"
import { BotIcon, CopyIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmButton } from "@/components/confirm-button"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { errorText, w } from "@/lib/work"

/*
The project-settings "Client access & feedback widget" section (P7): share the
project's client with a portal contact, mint / rotate / revoke the per-project
public feedback keys, set their allowed origins, and copy the <script> snippet a
client pastes onto their site. Manager+ only (the endpoints enforce it too).
*/

type FeedbackKey = {
  id: string
  project_id: string
  name: string
  public_key: string
  active: boolean
  allowed_origins: string[]
  widget: WidgetLook
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

type WidgetLook = {
  color?: string
  text_color?: string
  icon?: string
  text?: string
  shape?: string
  position?: string
  theme?: string
  locale?: string
}

type Contact = { id: string; client_id: string; user_id: string; email: string | null; created_at: string }

export function FeedbackWidgetSection({
  projectId,
  clientId,
}: {
  projectId: string
  clientId: string | null
}) {
  const ws = useWorkspace()
  const canManage = ws.can("feedback_keys:manage")

  const keys = useSWR<{ keys: FeedbackKey[] | null }>(
    [`/api/w/projects/${projectId}/feedback-keys`, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  const contacts = useSWR<{ contacts: Contact[] | null }>(
    clientId ? [`/api/w/clients/${clientId}/contacts`, ws.id] : null,
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )

  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorText(err, "Something went wrong"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-b border-line">
      <div className="px-6 pt-6 pb-3">
        <h2 className="text-base font-medium">Client access &amp; feedback widget</h2>
        <p className="mt-1 text-sm text-grid-muted">
          Give this project&apos;s client a login to the portal, and let their end-users file issues from
          their own website with an embeddable widget.
        </p>
      </div>

      <div className="px-6 pb-5">
        <h3 className="text-sm font-medium mb-2">Portal contacts</h3>
        {!clientId ? (
          <p className="text-sm text-grid-muted">
            Assign a client to this project first — portal access follows the client.
          </p>
        ) : (
          <ContactManager
            clientId={clientId}
            contacts={contacts.data?.contacts ?? []}
            canManage={canManage}
            busy={busy}
            onChange={() => contacts.mutate()}
            run={run}
          />
        )}
      </div>

      <div className="px-6 pb-6">
        <h3 className="text-sm font-medium mb-2">Feedback keys</h3>
        <KeyManager
          projectId={projectId}
          keys={keys.data?.keys ?? []}
          canManage={canManage}
          busy={busy}
          onChange={() => keys.mutate()}
          run={run}
        />
      </div>
    </section>
  )
}

function ContactManager({
  clientId,
  contacts,
  canManage,
  busy,
  onChange,
  run,
}: {
  clientId: string
  contacts: Contact[]
  canManage: boolean
  busy: boolean
  onChange: () => void
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
}) {
  const ws = useWorkspace()
  const [email, setEmail] = useState("")
  return (
    <div className="space-y-2">
      {contacts.length === 0 ? (
        <p className="text-sm text-grid-muted">No portal contacts yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">{c.email ?? c.user_id}</span>
              {canManage ? (
                <ConfirmButton
                  label="Remove"
                  title="Remove portal contact?"
                  description="They will lose access to this client's portal."
                  confirmLabel="Remove"
                  onConfirm={() =>
                    run(
                      () => w.del(ws.id, `/api/w/clients/${clientId}/contacts/${encodeURIComponent(c.user_id)}`),
                      "Removed",
                    ).then(onChange)
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const value = email.trim()
            if (!value) return
            run(
              () => w.put(ws.id, `/api/w/clients/${clientId}/contacts/${encodeURIComponent(value)}`),
              "Shared",
            ).then(() => {
              setEmail("")
              onChange()
            })
          }}
        >
          <Field className="flex-1">
            <FieldLabel>Add a contact (member email)</FieldLabel>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
          </Field>
          <Button type="submit" disabled={busy || !email.trim()}>
            <PlusIcon /> Add
          </Button>
        </form>
      ) : null}
    </div>
  )
}

function KeyManager({
  projectId,
  keys,
  canManage,
  busy,
  onChange,
  run,
}: {
  projectId: string
  keys: FeedbackKey[]
  canManage: boolean
  busy: boolean
  onChange: () => void
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
}) {
  const ws = useWorkspace()
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return (
    <div className="space-y-3">
      {keys.length === 0 ? (
        <p className="text-sm text-grid-muted">No feedback keys yet.</p>
      ) : (
        keys.map((k) => (
          <KeyRow key={k.id} k={k} origin={origin} canManage={canManage} busy={busy} run={run} onChange={onChange} />
        ))
      )}
      {canManage ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              () => w.post(ws.id, `/api/w/projects/${projectId}/feedback-keys`, { name: "Website widget", allowed_origins: [] }),
              "Key minted — add the client's origin below",
            ).then(onChange)
          }
        >
          <PlusIcon /> Mint a key
        </Button>
      ) : null}
    </div>
  )
}

function KeyRow({
  k,
  origin,
  canManage,
  busy,
  run,
  onChange,
}: {
  k: FeedbackKey
  origin: string
  canManage: boolean
  busy: boolean
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
  onChange: () => void
}) {
  const ws = useWorkspace()
  const [origins, setOrigins] = useState(k.allowed_origins.join("\n"))
  const snippet = useMemo(
    () => `<script src="${origin}/embed/v1.js" data-key="${k.public_key}" defer></script>`,
    [origin, k.public_key],
  )
  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Could not copy"),
    )
  }
  return (
    <div className="rounded-md border border-line p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <code className="truncate text-xs font-mono" dir="ltr">
            {k.public_key}
          </code>
          <Badge variant={k.active ? "default" : "secondary"}>{k.active ? "active" : "revoked"}</Badge>
        </div>
        {canManage && k.active ? (
          <ConfirmButton
            label={
              <>
                <RotateCcwIcon /> Revoke
              </>
            }
            title="Revoke this feedback key?"
            description="The embed widget using it will stop working immediately."
            confirmLabel="Revoke"
            onConfirm={() => run(() => w.post(ws.id, `/api/w/feedback-keys/${k.id}/revoke`), "Revoked").then(onChange)}
          />
        ) : null}
      </div>

      <Field>
        <FieldLabel>Allowed origins (one per line)</FieldLabel>
        <textarea
          className="min-h-[64px] w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm"
          dir="ltr"
          value={origins}
          disabled={!canManage || busy}
          onChange={(e) => setOrigins(e.target.value)}
          placeholder="https://client.example.com"
        />
      </Field>
      {canManage ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                w.patch(ws.id, `/api/w/feedback-keys/${k.id}`, {
                  allowed_origins: origins
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              "Origins saved",
            ).then(onChange)
          }
        >
          Save origins
        </Button>
      ) : null}

      <Field>
        <FieldLabel>Embed snippet</FieldLabel>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-grid-muted/10 px-2 py-1 text-xs" dir="ltr">
            {snippet}
          </code>
          <Button size="sm" variant="ghost" onClick={() => copy(snippet, "Snippet")}>
            <CopyIcon /> Copy
          </Button>
        </div>
      </Field>
      {k.active && canManage ? <WidgetLookEditor k={k} busy={busy} run={run} onChange={onChange} /> : null}
      {k.active ? <InstallGuides projectId={k.project_id} keyId={k.id} copy={copy} /> : null}
    </div>
  )
}

const ICONS = ["bug", "message", "help", "lightbulb", "megaphone", "sparkles", "none"]
const SHAPES = ["pill", "circle", "square", "tab"]
const POSITIONS = ["bottom-end", "bottom-start", "top-end", "top-start", "middle-end", "middle-start"]

// How this key's launcher looks on the customer's site (GET /api/feedback/embed/config).
// Visitors can still drag it, dock it to the edge or hide it from its right-click menu.
function WidgetLookEditor({
  k,
  busy,
  run,
  onChange,
}: {
  k: FeedbackKey
  busy: boolean
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
  onChange: () => void
}) {
  const ws = useWorkspace()
  const [look, setLook] = useState<WidgetLook>(k.widget ?? {})
  const set = (f: keyof WidgetLook, v: string) => setLook((l) => ({ ...l, [f]: v === "default" ? undefined : v }))
  const sel = (f: keyof WidgetLook, label: string, options: string[]) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <select
        className="h-8 w-full rounded-lg border border-line bg-transparent px-2 text-sm"
        value={look[f] ?? "default"}
        disabled={busy}
        onChange={(e) => set(f, e.target.value)}
      >
        <option value="default">Default</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  )
  const bg = look.color || "#8c3fb5"
  const fg = look.text_color || "#f0ebe1"
  const iconOnly = look.shape === "circle" || look.shape === "square"
  return (
    <Field>
      <FieldLabel>Launcher look</FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>Text</FieldLabel>
          <Input maxLength={40} value={look.text ?? ""} placeholder="Report a problem" disabled={busy} onChange={(e) => set("text", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>Colour</FieldLabel>
            <input type="color" className="h-8 w-full cursor-pointer rounded-lg border border-line bg-transparent" value={bg} disabled={busy} onChange={(e) => set("color", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Text colour</FieldLabel>
            <input type="color" className="h-8 w-full cursor-pointer rounded-lg border border-line bg-transparent" value={fg} disabled={busy} onChange={(e) => set("text_color", e.target.value)} />
          </Field>
        </div>
        {sel("icon", "Icon", ICONS)}
        {sel("shape", "Shape", SHAPES)}
        {sel("position", "Starting position", POSITIONS)}
        <div className="grid grid-cols-2 gap-3">
          {sel("theme", "Dialog theme", ["auto", "light", "dark"])}
          {sel("locale", "Language", ["auto", "en", "ar"])}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={
            "inline-flex h-10 items-center gap-2 px-4 text-sm font-medium shadow-md " +
            (iconOnly ? "w-12 justify-center px-0 " : "") +
            (look.shape === "square" ? "rounded-xl" : "rounded-full")
          }
          style={{ background: bg, color: fg }}
        >
          {look.icon === "none" ? null : <span className="text-xs">●</span>}
          {iconOnly ? null : look.text || "Report a problem"}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run(() => w.patch(ws.id, `/api/w/feedback-keys/${k.id}`, { widget: look }), "Launcher saved").then(onChange)}
        >
          Save look
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLook({})}>
          Reset
        </Button>
      </div>
    </Field>
  )
}

const STACK_LABELS: Record<string, string> = {
  agent: "AI agent",
  html: "HTML",
  laravel: "Laravel",
  node: "Node",
  next: "Next.js",
  go: "Go",
  python: "Python",
}

// The same guides the MCP tool get_feedback_install returns: one tab per stack, and
// "AI agent" is a complete prompt to paste into a coding agent in the client's repo.
function InstallGuides({
  projectId,
  keyId,
  copy,
}: {
  projectId: string
  keyId: string
  copy: (text: string, label: string) => void
}) {
  const ws = useWorkspace()
  const { data } = useSWR<{ guides: Record<string, string> }>(
    [`/api/w/projects/${projectId}/feedback-install?key=${encodeURIComponent(keyId)}`, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  if (!data?.guides) return null
  const stacks = Object.keys(STACK_LABELS).filter((s) => data.guides[s])
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Install</FieldLabel>
        <Button size="sm" variant="outline" onClick={() => copy(data.guides.agent, "Agent prompt")}>
          <BotIcon /> Copy agent prompt
        </Button>
      </div>
      <Tabs defaultValue="agent">
        <TabsList className="flex-wrap">
          {stacks.map((s) => (
            <TabsTrigger key={s} value={s}>
              {STACK_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
        {stacks.map((s) => (
          <TabsContent key={s} value={s} className="relative">
            <pre
              dir="ltr"
              className="max-h-72 overflow-auto rounded-md border border-line bg-grid-muted/10 p-3 pe-20 font-mono text-xs whitespace-pre-wrap"
            >
              {data.guides[s]}
            </pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1.5 end-1.5"
              onClick={() => copy(data.guides[s], STACK_LABELS[s])}
            >
              <CopyIcon /> Copy
            </Button>
          </TabsContent>
        ))}
      </Tabs>
      <p className="text-xs text-grid-muted">
        Or from any MCP client: <code dir="ltr">get_feedback_install {"{"} project, stack {"}"}</code>
      </p>
    </Field>
  )
}
