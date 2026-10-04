"use client"

import type { MouseEvent, ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SidebarItem, SidebarSubItem, useOptionalAppShell } from "@fadymondy/nasaq/web"

// A Nasaq SidebarItem wired to Next.js routing: the item renders a plain <a href>, so a normal
// left click is turned into a client-side navigation (and closes the mobile sheet); modified
// clicks keep the browser's open-in-new-tab behaviour.
export function NavItem({
  href,
  icon,
  children,
  exact = false,
  label,
  trailing,
  sub = false,
}: {
  href: string
  icon: ReactNode
  children: string
  exact?: boolean
  label?: string
  trailing?: ReactNode
  sub?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const shell = useOptionalAppShell()
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    shell?.setMobileOpen(false)
    router.push(href)
  }

  if (sub) {
    return (
      <SidebarSubItem href={href} active={active} onClick={onClick}>
        {children}
      </SidebarSubItem>
    )
  }
  return (
    <SidebarItem href={href} icon={icon} active={active} tooltip={label ?? children} trailing={trailing} onClick={onClick}>
      {children}
    </SidebarItem>
  )
}
