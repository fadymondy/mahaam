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
    <PublicFrame wide eyebrow={<Ltr>{me.data.email}</Ltr>} title={t("workspaces.title")} description={t("workspaces.pickHint")}>
      <section className="overflow-hidden rounded-floating border border-border">
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
        <ul className="divide-y divide-border">
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
      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="text-h2 mb-1">{t("workspaces.createTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("workspaces.createHint")}</p>
        </div>
        <div>
          <VerifyEmailGate email={me.data.email}>
            <CreateWorkspaceForm autoFocus={!list.isLoading && workspaces.length === 0} />
          </VerifyEmailGate>
        </div>
      </section>
    </PublicFrame>
  )
}
