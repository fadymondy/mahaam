"use client"

import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { CircleUserIcon, LogOutIcon, MessageSquarePlusIcon, ShieldIcon, UserIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePlatform } from "@/lib/admin"
import { api, resetCsrf } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

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
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("header.account")} />}>
        <UserIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="grid-micro block">{t("header.signedInAs")}</span>
            <span dir="ltr" className="ltr-isolate mt-1 block truncate text-sm text-grid-fg">
              {email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
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
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          {t("header.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
