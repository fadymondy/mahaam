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
    <div ref={ref} className="sticky top-0 z-50 bg-background" data-view-as={viewing.user_id}>
      <Alert
        tone="warning"
        icon={EyeIcon}
        // Flush across the top: no outer padding, rounding or side borders (MH-1180).
        className="rounded-none border-x-0 border-t-0"
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
