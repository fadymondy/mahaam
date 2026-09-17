"use client"

import { useMemo, useState } from "react"
import { CopyIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
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
    </div>
  )
}
