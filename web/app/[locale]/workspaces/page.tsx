"use client"

import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { Badge, Skeleton } from "@fadymondy/nasaq/web"


import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { VerifyEmailGate } from "@/components/account/verify-email-gate"
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { UserMenu } from "@/components/workspace/user-menu"
import { Ltr } from "@/components/copy-field"
import { useTranslations } from "@/lib/i18n"
import { useMyWorkspaces } from "@/lib/queries"
import { useRequireAuth } from "@/lib/use-require-auth"
import { useDocumentTitle } from "@/lib/title"

export default function WorkspacesPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(t("workspaces.title"))
  const me = useRequireAuth()
  const list = useMyWorkspaces(!!me.data)

  if (!me.data) {
    return (
      <PublicFrame title={t("workspaces.title")}>
        <PublicPanel>{me.error ? <ErrorState error={me.error} /> : <Skeleton className="h-24 w-full" />}</PublicPanel>
      </PublicFrame>
    )
  }

  const workspaces = list.data ?? []

  return (
    <PublicFrame eyebrow={<Ltr>{me.data.email}</Ltr>} title={t("workspaces.title")} description={t("workspaces.pickHint")}>
      <section className="border-t border-border border-b border-border border-x border-border">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
        <span className="text-eyebrow uppercase">{t("workspaces.title")}</span>
        <UserMenu email={me.data.email} />
      </div>

      {list.error ? (
        <ErrorState error={list.error} />
      ) : list.isLoading ? (
        <LoadingRows rows={2} />
      ) : workspaces.length === 0 ? (
        <EmptyState title={t("workspaces.emptyTitle")} body={t("workspaces.emptyBody")} />
      ) : (
        <ul className="divide-y divide-line">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/${locale}/w/${w.slug}`}
                className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted"
              >
                <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-card text-sm font-medium text-nq-brand">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{w.name}</span>
                  <Ltr mono className="text-xs text-muted-foreground">
                    /{w.slug}
                  </Ltr>
                </span>
                <Badge variant="outline">{t(`role.${w.role}`)}</Badge>
                <ChevronRightIcon className="size-4 text-muted-foreground rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      </section>
      <div className="border-t border-border" aria-hidden />
      <section className="border-t border-border border-b border-border grid border-x border-border md:grid-cols-2">
        <div className="border-border p-4 max-md:border-b md:border-e">
          <h2 className="mb-1 text-xl font-medium">{t("workspaces.createTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("workspaces.createHint")}</p>
        </div>
        <div className="p-4">
          <VerifyEmailGate email={me.data.email}>
            <CreateWorkspaceForm autoFocus={!list.isLoading && workspaces.length === 0} />
          </VerifyEmailGate>
        </div>
      </section>
    </PublicFrame>
  )
}
