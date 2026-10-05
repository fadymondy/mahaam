"use client"

import { useEffect, useRef } from "react"
import { EyeIcon, LogOutIcon } from "lucide-react"

import { Alert, Button } from "@fadymondy/nasaq/web"

import type { CurrentWorkspace } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { exitViewAs } from "@/lib/view-as"

/**
 * The top-of-panel alert while an owner/admin views the workspace as a member (MH-1159). It sits above
 * the whole shell; onHeight reports its height so the shell can take it off its 100dvh (AppShell offset).
 */
export function ViewAsBanner({
  viewing,
  home,
  onHeight,
}: {
  viewing: NonNullable<CurrentWorkspace["viewing_as"]>
  home: string
  onHeight: (px: number) => void
}) {
  const { t } = useTranslations()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    return () => {
      ro.disconnect()
      onHeight(0)
    }
  }, [onHeight])
  return (
    <div ref={ref} className="sticky top-0 z-50 border-b border-border bg-background p-2" data-view-as={viewing.user_id}>
      <Alert
        tone="warning"
        icon={EyeIcon}
        action={
          <Button variant="secondary" size="sm" onClick={() => exitViewAs(home)}>
            <LogOutIcon />
            {t("viewAs.exit")}
          </Button>
        }
      >
        <span dir="auto">{t("viewAs.banner", { email: viewing.email, role: t(`role.${viewing.role}`) })}</span>
      </Alert>
    </div>
  )
}
