"use client"

import Link from "next/link"
import { useState } from "react"
import { useParams } from "next/navigation"
import { InfoIcon, LogOutIcon, ShieldIcon, ShieldOffIcon, UserCheckIcon, UserXIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReasonDialog, StatusBadge } from "@/components/admin/reason-dialog"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { adminApi, useAdminUser } from "@/lib/admin"
import { formatDay, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslations()
  const me = useMe()
  const detail = useAdminUser(id)
  const [suspending, setSuspending] = useState(false)
  const [busy, setBusy] = useState(false)
  const u = detail.data?.user
  useDocumentTitle(`${u?.email ?? t("admin.nav.users")} · ${t("admin.title")}`)

  if (detail.error) return <ErrorState error={detail.error} />
  if (!u || !detail.data) return <LoadingRows rows={4} />
  const self = me.data && String(me.data.id) === String(u.id)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await detail.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeader
        micro={
          <Link href={`/${locale}/admin/users`} className="hover:underline">
            {t("admin.nav.users")}
          </Link>
        }
        title={<Ltr>{u.email}</Ltr>}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={u.status} />
            {u.is_admin ? (
              <span className="inline-flex items-center gap-1 text-meta">
                <ShieldIcon className="size-3" />
                {t("admin.users.isAdmin")}
              </span>
            ) : null}
          </span>
        }
      />
      {u.status === "suspended" && u.suspended_reason ? (
        <p className="border-t border-line bg-grid-soft/50 px-6 py-3 text-sm text-grid-danger-text" data-suspended-reason>
          {t("admin.suspendedBecause", { reason: u.suspended_reason })}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-px border-y border-line bg-line text-sm md:grid-cols-4">
        {[
          [t("admin.col.created"), formatDay(u.created_at, locale)],
          [t("admin.col.lastSeen"), u.last_seen_at ? timeAgo(u.last_seen_at, locale) : t("admin.never")],
          [t("admin.users.mcpTokens"), String(detail.data.mcp_tokens)],
          [t("admin.users.adminTokens"), String(detail.data.admin_tokens)],
        ].map(([k, v]) => (
          <div key={k} className="bg-grid-card px-6 py-3">
            <dt className="grid-micro">{k}</dt>
            <dd className="mt-1 text-grid-fg">
              <Ltr>{v}</Ltr>
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3 py-6">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("admin.users.actions")}</h2>
        <div className="flex flex-wrap gap-2 px-6">
          {u.status === "suspended" ? (
            <Button variant="outline" disabled={busy} onClick={() => run(() => adminApi.reactivateUser(u.id), t("admin.users.reactivated"))}>
              <UserCheckIcon />
              {t("admin.reactivate")}
            </Button>
          ) : (
            <Button variant="outline" disabled={busy || !!self} onClick={() => setSuspending(true)} data-suspend-user>
              <UserXIcon />
              {t("admin.suspend")}
            </Button>
          )}
          {u.is_admin ? (
            <Button variant="outline" disabled={busy || !!self} onClick={() => run(() => adminApi.setAdmin(u.id, false), t("admin.users.adminRevoked"))}>
              <ShieldOffIcon />
              {t("admin.users.revokeAdmin")}
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => run(() => adminApi.setAdmin(u.id, true), t("admin.users.adminGranted"))}>
              <ShieldIcon />
              {t("admin.users.grantAdmin")}
            </Button>
          )}
          <ConfirmButton
            label={
              <>
                <LogOutIcon />
                {t("admin.users.signOut")}
              </>
            }
            title={t("admin.users.signOutTitle")}
            description={t("admin.users.signOutBody", { email: u.email })}
            confirmLabel={t("admin.users.signOut")}
            onConfirm={() => run(() => adminApi.signOutUser(u.id), t("admin.users.signedOut"))}
          />
        </div>
        {self ? <p className="px-6 text-meta text-grid-muted">{t("admin.users.selfNote")}</p> : null}
        <p className="flex items-start gap-2 px-6 text-meta text-grid-muted" data-no-reset>
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          {t("admin.users.noReset")}
        </p>
      </section>

      <section className="space-y-3 pb-10">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("admin.col.workspaces")}</h2>
        {(u.workspaces ?? []).length === 0 ? (
          <EmptyState title={t("admin.users.noWorkspaces")} />
        ) : (
          <div className="border-y border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-6">{t("admin.col.workspace")}</TableHead>
                  <TableHead>{t("admin.col.role")}</TableHead>
                  <TableHead className="pe-6">{t("admin.col.plan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(u.workspaces ?? []).map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="ps-6">
                      <Link href={`/${locale}/admin/workspaces/${w.id}`} className="font-medium hover:underline">
                        {w.name}
                      </Link>{" "}
                      <Ltr className="text-meta text-grid-muted">{w.slug}</Ltr>
                    </TableCell>
                    <TableCell>{t(`role.${w.role}`)}</TableCell>
                    <TableCell className="pe-6">
                      <Ltr>{w.plan}</Ltr>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <ReasonDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={t("admin.users.suspendTitle")}
        description={t("admin.users.suspendBody", { email: u.email })}
        confirmLabel={t("admin.suspend")}
        onSubmit={async (reason) => {
          await adminApi.suspendUser(u.id, reason)
          toast.success(t("admin.users.suspended"))
          await detail.mutate()
        }}
      />
    </>
  )
}
