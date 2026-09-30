"use client"

import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { CircleUserIcon, MessageSquarePlusIcon, ShieldIcon } from "lucide-react"
import { DropdownMenuItem, UserMenu as NasaqUserMenu, toast } from "@fadymondy/nasaq/web"

import { usePlatform } from "@/lib/admin"
import { api, resetCsrf } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

// The account menu (identity, profile, admin panel, report a problem, theme, language, sign out).
// Nasaq's UserMenu owns the frame and the preferences; this supplies the product items and sign-out.
export function UserMenu({ email, onReport, profileHref }: { email: string; onReport?: () => void; profileHref?: string }) {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  // The admin panel link is shown only to platform admins (the API 404s everyone else).
  const platform = usePlatform()

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" })
    } catch {
      toast.error(t("common.networkError"))
      return
    }
    resetCsrf()
    // Drop every cached response: the next account must not see this one's data.
    await mutate(() => true, undefined, { revalidate: false })
    router.replace(`/${locale}/login`)
  }

  return (
    <NasaqUserMenu
      user={{ name: email.split("@")[0], email }}
      onSignOut={signOut}
      labels={{ signOut: t("header.signOut") }}
    >
      {profileHref ? (
        <DropdownMenuItem onClick={() => router.push(profileHref)}>
          <CircleUserIcon />
          {t("kpi.profile")}
        </DropdownMenuItem>
      ) : null}
      {platform.data?.is_admin ? (
        <DropdownMenuItem onClick={() => router.push(`/${locale}/admin`)} data-admin-link>
          <ShieldIcon />
          {t("admin.panel")}
        </DropdownMenuItem>
      ) : null}
      {onReport ? (
        <DropdownMenuItem onClick={onReport}>
          <MessageSquarePlusIcon />
          {t("feedback.report")}
        </DropdownMenuItem>
      ) : null}
    </NasaqUserMenu>
  )
}
