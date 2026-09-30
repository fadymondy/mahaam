"use client"

import Link from "next/link"
import { useState } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { FilterSelect, Pager, SearchBox } from "@/components/admin/pager"
import { StatusBadge } from "@/components/admin/reason-dialog"
import { UsageBar } from "@/components/admin/usage"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { planName, useAdminPlans, useAdminWorkspaces } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

/** The limits worth a glance in the list; the detail page shows all of them. */
const COMPACT = ["members", "projects", "storage_mb", "issues_per_month"]

export default function AdminWorkspacesPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(`${t("admin.nav.workspaces")} · ${t("admin.title")}`)
  const [q, setQ] = useState("")
  const [plan, setPlan] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const list = useAdminWorkspaces({ q, plan, status, page })
  const plans = useAdminPlans()
  const rows = list.data?.workspaces ?? []
  const planLabel = (key: string) => {
    const p = plans.data?.plans?.find((x) => x.key === key)
    return p ? planName(p, locale) : key
  }

  return (
    <>
      <SectionHeader micro={t("admin.title")} title={t("admin.nav.workspaces")} description={t("admin.workspaces.hint")} />
      <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
        <SearchBox
          placeholder={t("admin.workspaces.search")}
          onSearch={(v) => {
            setQ(v)
            setPage(1)
          }}
        />
        <FilterSelect
          label={t("admin.col.plan")}
          value={plan}
          onChange={(v) => {
            setPlan(v)
            setPage(1)
          }}
          items={[{ value: "", label: t("admin.filter.allPlans") }, ...(plans.data?.plans ?? []).map((p) => ({ value: p.key, label: planName(p, locale) }))]}
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
          ]}
        />
      </div>
      {list.error ? (
        <ErrorState error={list.error} />
      ) : !list.data ? (
        <LoadingRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.workspaces.empty")} />
      ) : (
        <>
          <div className="border-y border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-6">{t("admin.col.workspace")}</TableHead>
                  <TableHead>{t("admin.col.plan")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("admin.col.owner")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("admin.col.members")}</TableHead>
                  <TableHead className="hidden w-[34%] pe-6 lg:table-cell">{t("admin.col.usage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id} data-admin-workspace={w.slug}>
                    <TableCell className="max-w-0 ps-6">
                      <Link href={`/${locale}/admin/workspaces/${w.id}`} className="block truncate font-medium hover:underline">
                        {w.name}
                      </Link>
                      <span className="flex items-center gap-2">
                        <Ltr className="text-meta text-grid-muted">{w.slug}</Ltr>
                        <StatusBadge status={w.status} />
                      </span>
                    </TableCell>
                    <TableCell>{planLabel(w.plan)}</TableCell>
                    <TableCell className="hidden max-w-0 md:table-cell">
                      <Ltr className="block truncate text-sm">{w.owner_email ?? "—"}</Ltr>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Ltr className="tabular-nums">{w.members}</Ltr>
                      <span className="block text-meta text-grid-muted">{t("admin.workspaces.projectsN", { n: w.projects })}</span>
                    </TableCell>
                    <TableCell className="hidden pe-6 lg:table-cell">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {COMPACT.map((k) => {
                          const item = (w.usage ?? []).find((i) => i.key === k)
                          return item ? <UsageBar key={k} item={item} compact /> : null
                        })}
                      </div>
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
