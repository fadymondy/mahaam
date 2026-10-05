// View as (MH-1159): an owner or admin looks at a workspace through a team member's eyes. The
// choice lives in this tab's sessionStorage; api() sends it as X-View-As beside X-Workspace-ID,
// and the API answers read-only with that member's role (internal/tenant/viewas.go).

import { api, type Role } from "@/lib/api"

const KEY = "mahaam.viewAs"

export type ViewAs = { ws: string; slug: string; user_id: string; email: string; role: Role }

export function getViewAs(): ViewAs | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ViewAs) : null
  } catch {
    return null
  }
}

/** The member to send as X-View-As for a request to workspace ref (its id or slug). */
export function viewAsFor(ref: string): string | null {
  const v = getViewAs()
  return v && (v.ws === ref || v.slug === ref) ? v.user_id : null
}

/** Checks and records the switch on the server, then reloads into the member's view. */
export async function startViewAs(ws: { id: string; slug: string }, userId: string, home: string) {
  const out = await api<{ user_id: string; email: string; role: Role }>(`/api/w/members/${encodeURIComponent(userId)}/view-as`, {
    method: "POST",
    workspaceId: ws.id,
  })
  window.sessionStorage.setItem(KEY, JSON.stringify({ ws: ws.id, slug: ws.slug, ...out }))
  // A full load: every cached list belongs to the old viewer.
  window.location.assign(out.role === "client" ? `${home}/portal` : home)
}

export function exitViewAs(home: string) {
  window.sessionStorage.removeItem(KEY)
  window.location.assign(home)
}

/** Drops a stale choice (the member left, or was promoted above you) without navigating. */
export function clearViewAs() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(KEY)
}

/** X-Workspace-ID (+ X-View-As while viewing as someone) for the few raw fetch() calls outside api(). */
export function wsHeaders(ws: string): Record<string, string> {
  const as = viewAsFor(ws)
  return as ? { "X-Workspace-ID": ws, "X-View-As": as } : { "X-Workspace-ID": ws }
}
