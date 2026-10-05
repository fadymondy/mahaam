"use client"

import { EyeIcon } from "lucide-react"

import { Button } from "@fadymondy/nasaq/web"

import type { CurrentWorkspace } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { exitViewAs } from "@/lib/view-as"

/** The persistent strip while an owner/admin views the workspace as a member (MH-1159). */
export function ViewAsBanner({ viewing, home }: { viewing: NonNullable<CurrentWorkspace["viewing_as"]>; home: string }) {
  const { t } = useTranslations()
  return (
    <div
      role="status"
      data-view-as={viewing.user_id}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-nq-warning/40 bg-nq-warning-soft px-4 py-2 text-sm text-nq-warning-text sm:px-6"
    >
      <EyeIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1" dir="auto">
        {t("viewAs.banner", { email: viewing.email, role: t(`role.${viewing.role}`) })}
      </span>
      <Button variant="secondary" size="sm" onClick={() => exitViewAs(home)}>
        {t("viewAs.exit")}
      </Button>
    </div>
  )
}
