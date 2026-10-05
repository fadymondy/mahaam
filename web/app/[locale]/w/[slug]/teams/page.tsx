"use client"

import { useState } from "react"
import Link from "next/link"
import { PlusIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Textarea } from "@fadymondy/nasaq/web"





import { SectionHeader } from "@/components/public-frame"
import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { MemberPicker } from "@/components/work/fields"
import { ColorDot, ColorPicker } from "@/components/work/palette"
import { AvatarStack, useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { errorText, useTeams, w, type Team } from "@/lib/work"

export default function TeamsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.teams")} · ${ws.summary.name}`)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const teams = useTeams(ws.id, ws.can("teams:read"))
  const canWrite = ws.can("teams:write")
  const [editing, setEditing] = useState<Team | "new" | null>(null)
  const list = teams.data?.teams ?? []

  if (ws.current && !ws.can("teams:read")) return <p className="px-6 py-6 text-sm text-muted-foreground">{t("teams.noPermission")}</p>

  return (
    <>
      <SectionHeader
        title={t("nav.teams")}
        description={t("teams.hint")}
        action={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <PlusIcon />
              {t("teams.new")}
            </Button>
          ) : null
        }
      />
      {teams.error ? (
        <ErrorState error={teams.error} />
      ) : teams.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("teams.empty")} body={canWrite ? t("teams.emptyBody") : undefined} />
      ) : (
        <ul className="divide-y divide-line border-y border-border">
          {list.map((team) => (
            <li key={team.id} className="flex flex-wrap items-center gap-3 px-6 py-3" data-team={team.id}>
              <ColorDot color={team.color} className="size-3" />
              <div className="min-w-0 flex-1">
                <Link href={`/${locale}/w/${ws.slug}/teams/${team.id}`} className="block truncate font-medium text-foreground hover:underline">
                  {team.name}
                </Link>
                <p className="truncate text-caption text-muted-foreground">
                  {team.description ? `${team.description} · ` : ""}
                  {t("teams.memberCount", { n: team.member_ids.length })} · {t("teams.projectCount", { n: team.project_count })}
                </p>
              </div>
              <AvatarStack ids={team.member_ids} dir={dir} max={5} />
              {canWrite ? (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(team)}>
                    {t("common.edit")}
                  </Button>
                  <ConfirmButton
                    label={t("common.delete")}
                    title={t("teams.deleteTitle", { name: team.name })}
                    description={t("teams.deleteBody")}
                    confirmLabel={t("common.delete")}
                    onConfirm={async () => {
                      try {
                        await w.del(ws.id, `/api/w/teams/${team.id}`)
                        void teams.mutate()
                      } catch (err) {
                        toast.error(errorText(err, t("common.networkError")))
                      }
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <TeamDialog
        team={editing}
        dir={dir}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void teams.mutate()
        }}
      />
    </>
  )
}

function TeamDialog({ team, dir, onClose, onSaved }: { team: Team | "new" | null; dir: ReturnType<typeof useDirectory>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const existing = team && team !== "new" ? team : null
  const [key, setKey] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [color, setColor] = useState<string>("teal")
  const [members, setMembers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = team === "new" ? "new" : (existing?.id ?? null)
  if (current !== key) {
    setKey(current)
    setName(existing?.name ?? "")
    setDescription(existing?.description ?? "")
    setColor(existing?.color ?? "teal")
    setMembers(existing?.member_ids ?? [])
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    const body = { name: name.trim(), description, color, member_ids: members }
    try {
      if (existing) await w.patch(ws.id, `/api/w/teams/${existing.id}`, body)
      else await w.post(ws.id, "/api/w/teams", body)
      toast.success(t("common.saved"))
      onSaved()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? t("teams.edit") : t("teams.new")}</DialogTitle>
          <DialogDescription>{t("teams.formHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="t-name">{t("project.name")}</FieldLabel>
            <Input id="t-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="t-desc">
              {t("project.description")} <span className="text-muted-foreground">({t("common.optional")})</span>
            </FieldLabel>
            <Textarea id="t-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>{t("work.color")}</FieldLabel>
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <Field>
            <FieldLabel>{t("teams.members")}</FieldLabel>
            <MemberPicker dir={dir} selected={members} onChange={setMembers} label={t("teams.members")} />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
