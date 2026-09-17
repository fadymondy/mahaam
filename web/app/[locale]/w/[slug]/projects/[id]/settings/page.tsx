"use client"

import { useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { ColorDot, ColorPicker, PALETTE } from "@/components/work/palette"
import { useDirectory } from "@/components/work/people"
import { useProjectCtx } from "@/components/work/project-context"
import { ProjectForm } from "@/components/work/project-form"
import { FeedbackWidgetSection } from "@/components/work/feedback-widget"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { CATEGORIES, errorText, useTeams, w, type Status } from "@/lib/work"

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line">
      <div className="px-6 pt-6 pb-3">
        <h2 className="text-base font-medium">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-grid-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function ProjectSettingsPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { project: p, reload } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.settings")} · ${p.name}`)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const teams = useTeams(ws.id, ws.can("teams:read"))
  const [addUser, setAddUser] = useState("")
  const [addRole, setAddRole] = useState("member")
  const [addTeam, setAddTeam] = useState("")

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      reload()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  if (!p.can_manage) {
    return <p className="px-6 py-6 text-sm text-grid-muted">{t("settings.noPermission")}</p>
  }

  const memberIds = new Set(p.members.map((m) => m.user_id))
  const candidates = dir.members.filter((m) => !memberIds.has(m.user_id))
  const attached = new Set(p.teams.map((x) => x.team_id))
  const teamChoices = (teams.data?.teams ?? []).filter((x) => !attached.has(x.id))
  const roleItems = [
    { value: "member", label: t("projectRole.member") },
    { value: "lead", label: t("projectRole.lead") },
  ]

  return (
    <>
      <Section title={t("settings.details")}>
        <div className="px-6 pb-6">
          <ProjectForm key={p.updated_at} project={p} onSaved={() => { toast.success(t("common.saved")); reload() }} />
        </div>
      </Section>

      <Section title={t("settings.statuses")} hint={t("settings.statusesHint")}>
        <StatusManager statuses={p.statuses} projectId={p.id} onChanged={reload} />
      </Section>

      <Section title={t("settings.members")} hint={p.visibility === "members" ? t("settings.membersHintPrivate") : t("settings.membersHint")}>
        <ul className="divide-y divide-line border-y border-line">
          {p.members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate" dir="ltr">
                {dir.name(m.user_id)}
              </span>
              <Badge variant="outline">{t(`projectRole.${m.role}`)}</Badge>
              <ConfirmButton
                label={t("common.remove")}
                title={t("settings.removeMemberTitle")}
                description={t("settings.removeMemberBody", { name: dir.name(m.user_id) })}
                confirmLabel={t("common.remove")}
                onConfirm={() => run(() => w.del(ws.id, `/api/w/projects/${p.id}/members/${m.user_id}`))}
              />
            </li>
          ))}
        </ul>
        {candidates.length ? (
          <div className="flex flex-wrap items-end gap-2 px-6 py-4">
            <Field className="min-w-56 flex-1">
              <FieldLabel htmlFor="add-member">{t("settings.addMember")}</FieldLabel>
              <Select items={candidates.map((m) => ({ value: m.user_id, label: m.email }))} value={addUser} onValueChange={(v) => setAddUser(String(v ?? ""))}>
                <SelectTrigger id="add-member" className="w-full">
                  <SelectValue placeholder={t("settings.pickPerson")} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      <span dir="ltr">{m.email}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Select items={roleItems} value={addRole} onValueChange={(v) => setAddRole(String(v ?? "member"))}>
              <SelectTrigger className="w-32" aria-label={t("members.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!addUser} onClick={() => run(async () => { await w.put(ws.id, `/api/w/projects/${p.id}/members/${addUser}`, { role: addRole }); setAddUser("") })}>
              <PlusIcon />
              {t("common.add")}
            </Button>
          </div>
        ) : null}
      </Section>

      {ws.can("teams:read") ? (
        <Section title={t("settings.teams")} hint={t("settings.teamsHint")}>
          {p.teams.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {p.teams.map((x) => (
                <li key={x.team_id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                  <ColorDot color={x.color} />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="text-xs text-grid-muted">{t("teams.memberCount", { n: x.member_ids.length })}</span>
                  <Button variant="ghost" size="sm" onClick={() => run(() => w.del(ws.id, `/api/w/projects/${p.id}/teams/${x.team_id}`))}>
                    {t("settings.detach")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-6 pb-2 text-sm text-grid-muted">{t("settings.noTeams")}</p>
          )}
          {teamChoices.length ? (
            <div className="flex flex-wrap items-end gap-2 px-6 py-4">
              <Select items={teamChoices.map((x) => ({ value: x.id, label: x.name }))} value={addTeam} onValueChange={(v) => setAddTeam(String(v ?? ""))}>
                <SelectTrigger className="min-w-56" aria-label={t("settings.attachTeam")}>
                  <SelectValue placeholder={t("settings.pickTeam")} />
                </SelectTrigger>
                <SelectContent>
                  {teamChoices.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" disabled={!addTeam} onClick={() => run(async () => { await w.put(ws.id, `/api/w/projects/${p.id}/teams/${addTeam}`); setAddTeam("") })}>
                {t("settings.attachTeam")}
              </Button>
            </div>
          ) : null}
        </Section>
      ) : null}

      {ws.can("feedback_keys:read") ? <FeedbackWidgetSection projectId={p.id} clientId={p.client_id ?? null} /> : null}

      <Section title={p.archived_at ? t("settings.restoreTitle") : t("settings.archiveTitle")} hint={p.archived_at ? t("settings.restoreHint") : t("settings.archiveHint")}>
        <div className="px-6 pb-6">
          {p.archived_at ? (
            <Button variant="outline" onClick={() => run(() => w.post(ws.id, `/api/w/projects/${p.id}/restore`), t("project.restored"))}>
              {t("settings.restore")}
            </Button>
          ) : (
            <ConfirmButton
              label={t("settings.archive")}
              title={t("settings.archiveConfirm")}
              description={t("settings.archiveHint")}
              confirmLabel={t("settings.archive")}
              onConfirm={() => run(() => w.post(ws.id, `/api/w/projects/${p.id}/archive`), t("project.archived"))}
            />
          )}
        </div>
      </Section>
    </>
  )
}

function StatusManager({ statuses, projectId, onChanged }: { statuses: Status[]; projectId: string; onChanged: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [editing, setEditing] = useState<Status | "new" | null>(null)
  const [deleting, setDeleting] = useState<Status | null>(null)
  const [moveTo, setMoveTo] = useState("")

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onChanged()
      return true
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      return false
    }
  }

  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {statuses.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-6 py-2 text-sm" data-status-row={s.id}>
            <ColorDot color={s.color} />
            <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
            <Badge variant="outline">{t(`category.${s.category}`)}</Badge>
            <span className="w-16 text-end text-xs text-grid-muted">{t("settings.taskCount", { n: s.task_count })}</span>
            <Button variant="ghost" size="icon-sm" aria-label={t("settings.moveUp")} disabled={i === 0} onClick={() => run(() => w.patch(ws.id, `/api/w/statuses/${s.id}`, { index: i - 1 }))}>
              <ArrowUpIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("settings.moveDown")} disabled={i === statuses.length - 1} onClick={() => run(() => w.patch(ws.id, `/api/w/statuses/${s.id}`, { index: i + 1 }))}>
              <ArrowDownIcon />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
              {t("common.edit")}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.delete")}
              disabled={statuses.length <= 1}
              onClick={() => {
                setMoveTo(statuses.find((x) => x.id !== s.id)?.id ?? "")
                setDeleting(s)
              }}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <div className="px-6 py-4">
        <Button variant="outline" onClick={() => setEditing("new")}>
          <PlusIcon />
          {t("settings.addStatus")}
        </Button>
      </div>

      <StatusDialog
        status={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          const ok = await run(() =>
            editing === "new" ? w.post(ws.id, `/api/w/projects/${projectId}/statuses`, body) : w.patch(ws.id, `/api/w/statuses/${(editing as Status).id}`, body),
          )
          if (ok) setEditing(null)
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.deleteStatusTitle", { name: deleting?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {deleting?.task_count ? t("settings.deleteStatusMove", { n: deleting.task_count }) : t("settings.deleteStatusEmpty")}
            </DialogDescription>
          </DialogHeader>
          {deleting?.task_count ? (
            <Select
              items={statuses.filter((x) => x.id !== deleting.id).map((x) => ({ value: x.id, label: x.name }))}
              value={moveTo}
              onValueChange={(v) => setMoveTo(String(v ?? ""))}
            >
              <SelectTrigger className="w-full" aria-label={t("settings.moveTasksTo")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses
                  .filter((x) => x.id !== deleting.id)
                  .map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return
                const qs = deleting.task_count ? `?move_to=${encodeURIComponent(moveTo)}` : ""
                if (await run(() => w.del(ws.id, `/api/w/statuses/${deleting.id}${qs}`))) setDeleting(null)
              }}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatusDialog({ status, onClose, onSave }: { status: Status | "new" | null; onClose: () => void; onSave: (b: { name: string; color: string; category: string }) => Promise<void> }) {
  const { t } = useTranslations()
  const s = status && status !== "new" ? status : null
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>("slate")
  const [category, setCategory] = useState("doing")
  const [key, setKey] = useState<string | null>(null)
  const current = status === "new" ? "new" : (s?.id ?? null)
  if (current !== key) {
    setKey(current)
    setName(s?.name ?? "")
    setColor(s?.color ?? PALETTE[8])
    setCategory(s?.category ?? "doing")
  }
  const catItems = CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))
  return (
    <Dialog open={!!status} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{status === "new" ? t("settings.addStatus") : t("settings.editStatus")}</DialogTitle>
          <DialogDescription>{t("settings.categoryHint")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="st-name">{t("project.name")}</FieldLabel>
          <Input id="st-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="st-cat">{t("settings.category")}</FieldLabel>
          <Select items={catItems} value={category} onValueChange={(v) => setCategory(String(v ?? "doing"))}>
            <SelectTrigger id="st-cat" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catItems.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t("work.color")}</FieldLabel>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), color, category })}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Keep Ltr referenced for counts rendered via t() in some locales.
void Ltr
