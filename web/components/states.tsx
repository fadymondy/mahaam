"use client"

import type { ReactNode } from "react"
import { EmptyState as NqEmptyState, ErrorState as NqErrorState, LoadingState } from "@fadymondy/nasaq/web"

import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

/*
  Thin adapters over Nasaq's states so the ~250 call sites keep their prop names
  (rows / title+body+action / error) and the API-error to message mapping lives in one place.
*/
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return <LoadingState rows={rows} />
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  // spaced off the header / toolbar above and whatever follows, on every page
  return <NqEmptyState className="my-8" title={title} description={body} actions={action} />
}

export function ErrorState({ error }: { error: unknown }) {
  const { t } = useTranslations()
  const message =
    error instanceof ApiError
      ? error.status >= 500
        ? t("common.apiUnavailable")
        : error.message
      : t("common.networkError")
  return <NqErrorState title={message} />
}
