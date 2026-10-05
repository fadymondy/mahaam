"use client"

import { useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MailWarningIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"

import { Badge, Button, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, DataTable, DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { DataView } from "@/components/data-view"
import { Page, PageHeader, Panel } from "@/components/page"
import { ConfirmButton } from "@/components/confirm-button"
import { CopyField, Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api, ApiError, INVITABLE_ROLES, type Invitation, type Member } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useInvitations, useMembers } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

export default function MembersPage() {
  const { t, locale, formatDate } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.members")} · ${ws.summary.name}`)

  const canInvite = ws.can("members:invite")
  const members = useMembers(ws.id)
  const invitations = useInvitations(ws.id, canInvite)
  const router = useRouter()
  const list = useMemo(() => members.data?.members ?? [], [members.data])
  const roles = useMemo(() => [...new Set(list.map((m) => m.role))], [list])
  const statuses = useMemo(() => [...new Set(list.map((m) => m.status))], [list])
  const columns = useMemo<DataTableColumn<Member>[]>(
    () => [
      {
        id: "email",
        header: t("members.email"),
        hideable: false,
        sortValue: (m) => m.email,
        searchValue: (m) => m.email,
        cell: (m) => (
          <Link href={`/${locale}/w/${ws.slug}/members/${m.user_id}`} className="hover:underline">
            <Ltr>{m.email}</Ltr>
          </Link>
        ),
      },
      { id: "role", header: t("members.role"), sortValue: (m) => m.role, filterValue: (m) => m.role, cell: (m) => <Badge variant="outline">{t(`role.${m.role}`)}</Badge> },
      { id: "status", header: t("members.status"), sortValue: (m) => m.status, filterValue: (m) => m.status, className: "text-muted-foreground", cell: (m) => t(`status.${m.status}`) },
      {
        id: "joined",
        header: t("members.joined"),
        sortValue: (m) => m.joined_at,
        className: "text-muted-foreground",
        cell: (m) => <Ltr>{formatDate(m.joined_at)}</Ltr>,
      },
    ],
    [t, locale, ws.slug, formatDate],
  )
  const table = useDataTable({ data: list, columns, getRowId: (m) => m.user_id, pageSize: 25, defaultSort: { id: "email", direction: "asc" } })

  return (
    <Page>
      <PageHeader
        title={t("nav.members")}
        description={t("members.hint")}
        actions={
          ws.can("kpi:all") ? (
            <Button variant="secondary" nativeButton={false} render={<Link href={`/${locale}/w/${ws.slug}/members/kpi`} />}>
              {t("kpi.teamTitle")}
            </Button>
          ) : null
        }
      />

      {members.error ? (
        <ErrorState error={members.error} />
      ) : (
        <DataView
          table={table}
          label={t("nav.members")}
          rowLabel={(m) => m.email}
          loading={members.isLoading}
          empty={<EmptyState title={t("members.empty")} />}
          onRowClick={(m) => router.push(`/${locale}/w/${ws.slug}/members/${m.user_id}`)}
          search={t("members.search")}
          filters={
            <>
              <DataTableFacetFilter table={table} column="role" title={t("members.role")} options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
              <DataTableFacetFilter table={table} column="status" title={t("members.status")} options={statuses.map((v) => ({ value: v, label: t(`status.${v}`) }))} />
            </>
          }
        />
      )}

      {canInvite ? (
        <>
          <InviteSection />
          <PendingInvitations
            loading={invitations.isLoading}
            error={invitations.error}
            items={invitations.data?.invitations ?? []}
            onRevoked={() => invitations.mutate()}
            formatDate={formatDate}
          />
        </>
      ) : ws.current ? (
        <p className="text-sm text-muted-foreground">{t("members.noInvitePermission")}</p>
      ) : null}
    </Page>
  )
}

function InviteSection() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const invitations = useInvitations(ws.id)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<string>("member")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<{ url: string; email: string } | null>(null)

  const roleItems = INVITABLE_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ invitation: Invitation; accept_url: string }>("/api/w/invitations", {
        json: { email: email.trim(), role },
        workspaceId: ws.id,
      })
      const path = res.accept_url.startsWith("/") ? res.accept_url : `/${res.accept_url}`
      setLink({ url: `${window.location.origin}/${locale}${path}`, email: email.trim() })
      setEmail("")
      await invitations.mutate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t("members.inviteTitle")}
      // P0 sends no email — say so plainly instead of implying it does.
      description={
        <span className="flex items-start gap-2">
          <MailWarningIcon className="mt-0.5 size-4 shrink-0 text-nq-warn-text" />
          {t("members.noEmail")}
        </span>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field className="sm:flex-1">
            <FieldLabel htmlFor="invite-email">{t("members.email")}</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </Field>
          <Field className="sm:w-44">
            <FieldLabel htmlFor="invite-role">{t("members.role")}</FieldLabel>
            <Select items={roleItems} value={role} onValueChange={(v) => setRole(String(v ?? "member"))}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
            {busy ? t("common.working") : t("members.invite")}
          </Button>
        </div>
        {error ? <FormError className="mt-3">{error}</FormError> : null}
      </form>

      {link ? (
        <div className="mt-6 space-y-2 border border-border bg-card p-4" role="status">
          <p className="text-sm font-medium">
            {t("members.linkReady")} <Ltr>{link.email}</Ltr>
          </p>
          <p className="text-caption text-nq-warn-text">{t("members.linkOnce")}</p>
          <CopyField value={link.url} label={t("members.acceptLink")} />
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setLink(null)}>
              {t("common.done")}
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function PendingInvitations({
  loading,
  error,
  items,
  onRevoked,
  formatDate,
}: {
  loading: boolean
  error: unknown
  items: Invitation[]
  onRevoked: () => void
  formatDate: (v: string | null | undefined) => string
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()

  const columns: DataTableColumn<Invitation>[] = [
    { id: "email", header: t("members.email"), sortValue: (inv) => inv.email, cell: (inv) => <Ltr>{inv.email}</Ltr> },
    { id: "role", header: t("members.role"), sortValue: (inv) => inv.role, cell: (inv) => <Badge variant="outline">{t(`role.${inv.role}`)}</Badge> },
    { id: "expires", header: t("members.expires"), sortValue: (inv) => inv.expires_at, className: "text-muted-foreground", cell: (inv) => <Ltr>{formatDate(inv.expires_at)}</Ltr> },
    {
      id: "revoke",
      header: <span className="sr-only">{t("common.actions")}</span>,
      label: t("common.actions"),
      hideable: false,
      align: "end",
      cell: (inv) => (
        <ConfirmButton
          label={t("common.revoke")}
          title={t("members.revokeTitle")}
          description={t("members.revokeBody", { email: inv.email })}
          confirmLabel={t("common.revoke")}
          onConfirm={() => revoke(inv.id)}
        />
      ),
    },
  ]
  const table = useDataTable({ data: items, columns, getRowId: (inv) => inv.id, defaultSort: { id: "expires", direction: "asc" } })

  async function revoke(id: string) {
    try {
      await api(`/api/w/invitations/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws.id })
      toast.success(t("members.revoked"))
      onRevoked()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    }
  }

  return (
    <Panel flush title={t("members.pending")}>
      {error ? (
        <ErrorState error={error} />
      ) : loading ? (
        <LoadingRows rows={2} />
      ) : (
        <DataTable table={table} label={t("members.pending")} rowLabel={(inv) => inv.email} empty={<EmptyState title={t("members.noPending")} />} />
      )}
    </Panel>
  )
}
