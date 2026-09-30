"use client"

import { Fragment, useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"


import { Pager, SearchBox } from "@/components/admin/pager"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useAdminAudit } from "@/lib/admin"
import { intlTag } from "@/lib/i18n-locale"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

export default function AdminAuditPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(`${t("admin.nav.audit")} · ${t("admin.title")}`)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const audit = useAdminAudit({ q, page })
  const rows = audit.data?.entries ?? []
  const at = (v: string) => new Intl.DateTimeFormat(intlTag(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(v))

  return (
    <>
      <SectionHeader micro={t("admin.title")} title={t("admin.nav.audit")} description={t("admin.audit.hint")} />
      <div className="px-6 pb-4">
        <SearchBox
          placeholder={t("admin.audit.search")}
          onSearch={(v) => {
            setQ(v)
            setPage(1)
          }}
        />
      </div>
      {audit.error ? (
        <ErrorState error={audit.error} />
      ) : !audit.data ? (
        <LoadingRows rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.audit.empty")} />
      ) : (
        <>
          <div className="border-y border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-6">{t("admin.audit.at")}</TableHead>
                  <TableHead>{t("admin.audit.actor")}</TableHead>
                  <TableHead>{t("admin.audit.action")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("admin.audit.target")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("admin.audit.ip")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("admin.audit.via")}</TableHead>
                  <TableHead className="pe-6 text-end">
                    <span className="sr-only">{t("admin.audit.changes")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <Fragment key={e.id}>
                    <TableRow data-audit={e.action}>
                      <TableCell className="ps-6 whitespace-nowrap text-grid-muted">
                        <Ltr>{at(e.at)}</Ltr>
                      </TableCell>
                      <TableCell className="max-w-0">
                        <Ltr className="block truncate">{e.actor_email ?? "—"}</Ltr>
                      </TableCell>
                      <TableCell>
                        <Ltr mono className="text-xs">
                          {e.action}
                        </Ltr>
                      </TableCell>
                      <TableCell className="hidden max-w-0 md:table-cell">
                        <span className="block truncate text-sm">
                          <span className="text-grid-muted">{e.target_type}</span> {e.target_label ? <Ltr>{e.target_label}</Ltr> : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Ltr mono className="text-xs text-grid-muted">
                          {e.ip ?? "—"}
                        </Ltr>
                      </TableCell>
                      <TableCell className="hidden text-grid-muted lg:table-cell">{e.via ?? "—"}</TableCell>
                      <TableCell className="pe-6 text-end">
                        {e.changes ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-expanded={open === e.id}
                            aria-label={t("admin.audit.changes")}
                            onClick={() => setOpen(open === e.id ? null : e.id)}
                          >
                            <ChevronDownIcon className={cn("transition-transform", open === e.id && "rotate-180")} />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {open === e.id && e.changes ? (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-grid-soft/50 px-6">
                          <pre dir="ltr" className="max-h-80 overflow-auto text-start font-mono text-xs whitespace-pre-wrap">
                            {JSON.stringify(e.changes, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={audit.data.page} perPage={audit.data.per_page} total={audit.data.total} onPage={setPage} />
        </>
      )}
    </>
  )
}
