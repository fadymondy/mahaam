"use client"

import Link from "next/link"
import { useState } from "react"
import { ShieldIcon } from "lucide-react"

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"


import { FilterSelect, Pager, SearchBox } from "@/components/admin/pager"
import { StatusBadge } from "@/components/admin/reason-dialog"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useAdminUsers } from "@/lib/admin"
import { timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function AdminUsersPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(`${t("admin.nav.users")} · ${t("admin.title")}`)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const list = useAdminUsers({ q, status, page })
  const users = list.data?.users ?? []

  return (
    <>
      <SectionHeader micro={t("admin.title")} title={t("admin.nav.users")} description={t("admin.users.hint")} />
      <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
        <SearchBox
          placeholder={t("admin.users.search")}
          onSearch={(v) => {
            setQ(v)
            setPage(1)
          }}
        />
        <FilterSelect
          label={t("admin.col.status")}
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          items={[
            { value: "", label: t("admin.filter.all") },
            { value: "active", label: t("admin.status.active") },
            { value: "suspended", label: t("admin.status.suspended") },
            { value: "admin", label: t("admin.users.admins") },
          ]}
        />
      </div>
      {list.error ? (
        <ErrorState error={list.error} />
      ) : !list.data ? (
        <LoadingRows rows={6} />
      ) : users.length === 0 ? (
        <EmptyState title={t("admin.users.empty")} />
      ) : (
        <>
          <div className="border-y border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-6">{t("admin.col.email")}</TableHead>
                  <TableHead>{t("admin.col.status")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("admin.col.lastSeen")}</TableHead>
                  <TableHead className="hidden lg:table-cell pe-6">{t("admin.col.workspaces")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} data-admin-user={u.id}>
                    <TableCell className="max-w-0 ps-6">
                      <Link href={`/${locale}/admin/users/${u.id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                        <Ltr className="truncate">{u.email}</Ltr>
                        {u.is_admin ? (
                          <Badge variant="outline" className="gap-1">
                            <ShieldIcon className="size-3" />
                            {t("admin.badge")}
                          </Badge>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{u.last_seen_at ? timeAgo(u.last_seen_at, locale) : t("admin.never")}</TableCell>
                    <TableCell className="hidden max-w-0 pe-6 lg:table-cell">
                      <span className="block truncate text-sm text-nq-fg-body">
                        {(u.workspaces ?? []).length
                          ? (u.workspaces ?? []).map((w) => `${w.name} (${t(`role.${w.role}`)})`).join(", ")
                          : "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={list.data.page} perPage={list.data.per_page} total={list.data.total} onPage={setPage} />
        </>
      )}
    </>
  )
}
