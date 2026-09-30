"use client"

import Link from "next/link"

import { Button, ProductMark } from "@fadymondy/nasaq/web"

import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

/** A proper not-found state: used by the 404 pages and by an unknown workspace slug. */
export function NotFoundState({
  title,
  body,
  backHref,
  backLabel,
}: {
  title?: string
  body?: string
  backHref?: string
  backLabel?: string
}) {
  const { t, locale } = useTranslations()
  useDocumentTitle(title ?? t("notFound.title"))

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
      <ProductMark brand="mahaam" size={40} title="" />
      <p className="text-eyebrow uppercase">404</p>
      <h1 className="text-h2 text-2xl">{title ?? t("notFound.title")}</h1>
      <p className="text-body text-nq-fg-body max-w-md text-sm">{body ?? t("notFound.body")}</p>
      <Button variant="secondary" nativeButton={false} render={<Link href={backHref ?? `/${locale}/workspaces`} />}>
        {backLabel ?? t("notFound.back")}
      </Button>
    </div>
  )
}
