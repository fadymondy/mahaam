"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ColumnsIcon,
  MessageSquarePlusIcon,
  PlugIcon,
  PlusIcon,
  SettingsIcon,
  Share2Icon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
  SettingsSection,
  SettingsSections,
  Switch,
  toast,
  type SettingsGroup,
} from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { ColorDot, ColorPicker, PALETTE, soft } from "@/components/work/palette"
import { useDirectory } from "@/components/work/people"
import { useProjectCtx } from "@/components/work/project-context"
import { ProjectForm } from "@/components/work/project-form"
import { ProjectAvatarField } from "@/components/work/project-avatar"
import { FeedbackWidgetSection } from "@/components/work/feedback-widget"
import { IntegrationsSection } from "@/components/work/integrations-section"
import { ProjectLabelsSection } from "@/components/work/project-labels-section"
import { STAGE_ICON, STATUS_ICONS, StatusIcon, statusLabel } from "@/components/work/status-icon"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import { ISSUE_STATUSES, errorText, useTeams, w, type Status } from "@/lib/work"

/*
Project settings on Nasaq SettingsSections: grouped pages in a side nav (a select on narrow
screens) with search, the open page in ?s=<id>. Each page is one or more SettingsSection cards;
every control saves on its own, so there is no save bar. Manager+ (can_manage).
*/
// Settings pages sit flat on the page: the section keeps its heading and description but loses
// the card (border, fill and the parts' inset).
const FLAT = "border-transparent bg-transparent py-0 shadow-none *:px-0"

export default function ProjectSettingsPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const { project: p, reload, base } = useProjectCtx()
  const sec = useSearchParams().get("s")
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
    return <p className="px-6 py-6 text-sm text-muted-foreground">{t("settings.noPermission")}</p>
  }

  const memberIds = new Set(p.members.map((m) => m.user_id))
  const candidates = dir.members.filter((m) => !memberIds.has(m.user_id))
  const attached = new Set(p.teams.map((x) => x.team_id))
  const teamChoices = (teams.data?.teams ?? []).filter((x) => !attached.has(x.id))
  const roleItems = [
    { value: "member", label: t("projectRole.member") },
    { value: "lead", label: t("projectRole.lead") },
  ]

  const details = (
    <SettingsSection className={FLAT} title={t("settings.details")} description={t("settings.card.details")}>
      <div className="flex flex-col gap-6">
        <ProjectAvatarField project={p} onChanged={reload} />
        <ProjectForm
          key={p.updated_at}
          project={p}
          onSaved={() => {
            toast.success(t("common.saved"))
            reload()
          }}
        />
      </div>
    </SettingsSection>
  )

  const statuses = (
    <SettingsSection className={FLAT} title={t("settings.statuses")} description={t("settings.statusesHint")}>
      <StatusManager statuses={p.statuses} projectId={p.id} onChanged={reload} />
    </SettingsSection>
  )

  const members = (
    <SettingsSection className={FLAT} title={t("settings.members")} description={p.visibility === "members" ? t("settings.membersHintPrivate") : t("settings.membersHint")}>
      <ul className="divide-y divide-border border-y border-border">
        {p.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
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
        <div className="flex flex-wrap items-end gap-2 pt-4">
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
          <Button
            variant="primary"
            disabled={!addUser}
            onClick={() =>
              run(async () => {
                await w.put(ws.id, `/api/w/projects/${p.id}/members/${addUser}`, { role: addRole })
                setAddUser("")
              })
            }
          >
            <PlusIcon />
            {t("common.add")}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  )

  const teamsPage = (
    <SettingsSection className={FLAT} title={t("settings.teams")} description={t("settings.teamsHint")}>
      {p.teams.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {p.teams.map((x) => (
            <li key={x.team_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <ColorDot color={x.color} />
              <span className="min-w-0 flex-1 truncate">{x.name}</span>
              <span className="text-caption text-muted-foreground">{t("teams.memberCount", { n: x.member_ids.length })}</span>
              <Button variant="ghost" size="sm" onClick={() => run(() => w.del(ws.id, `/api/w/projects/${p.id}/teams/${x.team_id}`))}>
                {t("settings.detach")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings.noTeams")}</p>
      )}
      {teamChoices.length ? (
        <div className="flex flex-wrap items-end gap-2 pt-4">
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
          <Button
            variant="secondary"
            disabled={!addTeam}
            onClick={() =>
              run(async () => {
                await w.put(ws.id, `/api/w/projects/${p.id}/teams/${addTeam}`)
                setAddTeam("")
              })
            }
          >
            {t("settings.attachTeam")}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  )

  const SHARE = ["share_board", "share_team", "share_money"] as const
  const share = (
    <SettingsSection className={FLAT} title={t("settings.share")} description={t("settings.shareHint")}>
      <div className="divide-y divide-border">
        {SHARE.map((k) => (
          <SettingRow key={k} id={k} label={t(`settings.${k}`)} description={t(`settings.${k}Hint`)} data-share={k}>
            <Switch
              checked={p[k]}
              onCheckedChange={(v) => run(() => w.patch(ws.id, `/api/w/projects/${p.id}`, { [k]: v }), t("common.saved"))}
              aria-label={t(`settings.${k}`)}
            />
          </SettingRow>
        ))}
      </div>
    </SettingsSection>
  )

  const archive = (
    <SettingsSection
      className={FLAT}
      tone="danger"
      title={p.archived_at ? t("settings.restoreTitle") : t("settings.archiveTitle")}
      description={p.archived_at ? t("settings.restoreHint") : t("settings.archiveHint")}
    >
      <div>
        {p.archived_at ? (
          <Button variant="secondary" onClick={() => run(() => w.post(ws.id, `/api/w/projects/${p.id}/restore`), t("project.restored"))}>
            {t("settings.restore")}
          </Button>
        ) : (
          <ConfirmButton
            label={
              <>
                <ArchiveIcon />
                {t("settings.archive")}
              </>
            }
            title={t("settings.archiveConfirm")}
            description={t("settings.archiveHint")}
            confirmLabel={t("settings.archive")}
            onConfirm={() => run(() => w.post(ws.id, `/api/w/projects/${p.id}/archive`), t("project.archived"))}
          />
        )}
      </div>
    </SettingsSection>
  )

  const groups: SettingsGroup[] = [
    {
      id: "project",
      label: t("settings.group.project"),
      pages: [
        { id: "details", label: t("settings.details"), description: t("settings.card.details"), icon: <SettingsIcon />, content: details },
        { id: "statuses", label: t("settings.statuses"), description: t("settings.statusesHint"), icon: <ColumnsIcon />, content: statuses },
        ...(ws.can("access:manage")
          ? [{ id: "labels", label: t("settings.card.labelsTitle"), description: t("settings.card.labels"), icon: <TagIcon />, content: <ProjectLabelsSection projectId={p.id} /> }]
          : []),
      ],
    },
    {
      id: "people",
      label: t("settings.group.people"),
      pages: [
        { id: "members", label: t("settings.members"), description: t("settings.membersHint"), icon: <UsersIcon />, content: members },
        ...(ws.can("teams:read") ? [{ id: "teams", label: t("settings.teams"), description: t("settings.teamsHint"), icon: <UsersRoundIcon />, content: teamsPage }] : []),
        {
          id: "share",
          label: t("settings.share"),
          description: t("settings.shareHint"),
          icon: <Share2Icon />,
          entries: SHARE.map((k) => ({ id: k, label: t(`settings.${k}`), description: t(`settings.${k}Hint`) })),
          content: share,
        },
      ],
    },
    {
      id: "connect",
      label: t("settings.group.connect"),
      pages: [
        ...(ws.can("integrations:read")
          ? [
              {
                id: "integrations",
                label: t("settings.card.integrationsTitle"),
                description: t("settings.card.integrations"),
                icon: <PlugIcon />,
                keywords: ["github", "jira", "linear", "hosbah", "hosting"],
                content: <IntegrationsSection projectId={p.id} />,
              },
            ]
          : []),
        ...(ws.can("feedback_keys:read")
          ? [
              {
                id: "feedback",
                label: t("settings.card.feedbackTitle"),
                description: t("settings.card.feedback"),
                icon: <MessageSquarePlusIcon />,
                content: <FeedbackWidgetSection projectId={p.id} clientId={p.client_id ?? null} />,
              },
            ]
          : []),
      ],
    },
    {
      id: "danger",
      label: t("settings.group.danger"),
      pages: [
        {
          id: "archive",
          label: p.archived_at ? t("settings.restoreTitle") : t("settings.archiveTitle"),
          description: p.archived_at ? t("settings.restoreHint") : t("settings.archiveHint"),
          icon: <ArchiveIcon />,
          tone: "danger" as const,
          content: archive,
        },
      ],
    },
  ].filter((g) => g.pages.length > 0)

  const ids = groups.flatMap((g) => g.pages.map((x) => x.id))
  const active = sec && ids.includes(sec) ? sec : "details"

  return (
    <div className="p-4 sm:p-6" data-project-settings>
      <SettingsSections
        groups={groups}
        value={active}
        onValueChange={(id) => router.replace(`${base}/settings?s=${id}`, { scroll: false })}
        title={t("projectTab.settings")}
        description={null}
        labels={{ search: t("settings.search"), searchLabel: t("settings.search") }}
      />
    </div>
  )
}

// The column's label in the other locale, when it differs: shown next to the current one so both can be checked at a glance.
function otherLabel(s: Status, locale: string) {
  const other = s.labels?.[locale === "ar" ? "en" : "ar"]
  return other && other !== statusLabel(s, locale) ? other : ""
}

function StatusManager({ statuses, projectId, onChanged }: { statuses: Status[]; projectId: string; onChanged: () => void }) {
  const { t, locale } = useTranslations()
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
      <ul className="divide-y divide-border border-y border-border">
        {statuses.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm" data-status-row={s.id}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md" style={{ background: soft(s.color) }}>
              <StatusIcon status={s} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium" dir="auto">
                {statusLabel(s, locale)}
              </span>
              {otherLabel(s, locale) ? (
                <span className="ms-2 text-caption text-muted-foreground" dir="auto">
                  {otherLabel(s, locale)}
                </span>
              ) : null}
            </span>
            <Badge variant="outline">{t(`issues.status.${s.stage ?? "todo"}`)}</Badge>
            <span className="w-16 text-end text-caption text-muted-foreground">{t("settings.taskCount", { n: s.task_count })}</span>
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
      <div className="pt-4">
        <Button variant="secondary" onClick={() => setEditing("new")}>
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
            <DialogTitle>{t("settings.deleteStatusTitle", { name: deleting ? statusLabel(deleting, locale) : "" })}</DialogTitle>
            <DialogDescription>
              {deleting?.task_count ? t("settings.deleteStatusMove", { n: deleting.task_count }) : t("settings.deleteStatusEmpty")}
            </DialogDescription>
          </DialogHeader>
          {deleting?.task_count ? (
            <Select
              items={statuses.filter((x) => x.id !== deleting.id).map((x) => ({ value: x.id, label: statusLabel(x, locale) }))}
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
                      {statusLabel(x, locale)}
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
              variant="danger"
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

type StatusBody = { name: string; labels: Record<string, string>; icon: string; color: string; stage: string }

function StatusDialog({ status, onClose, onSave }: { status: Status | "new" | null; onClose: () => void; onSave: (b: StatusBody) => Promise<void> }) {
  const { t, locale } = useTranslations()
  const s = status && status !== "new" ? status : null
  const [en, setEn] = useState("")
  const [ar, setAr] = useState("")
  const [icon, setIcon] = useState("")
  const [color, setColor] = useState<string>("slate")
  const [category, setCategory] = useState("in_progress")
  const [key, setKey] = useState<string | null>(null)
  const current = status === "new" ? "new" : (s?.id ?? null)
  if (current !== key) {
    setKey(current)
    // A column labelled before translations existed keeps its name as the label of the current locale.
    setEn(s?.labels?.en ?? (s && locale !== "ar" ? s.name : ""))
    setAr(s?.labels?.ar ?? (s && locale === "ar" ? s.name : ""))
    setIcon(s?.icon ?? "")
    setColor(s?.color ?? PALETTE[8])
    setCategory(s?.stage ?? "in_progress")
  }
  // The name the API matches on: English, else Arabic.
  const name = en.trim() || ar.trim()
  const shown = icon || STAGE_ICON[category] || "circle"
  const catItems = ISSUE_STATUSES.map((c) => ({ value: c as string, label: t(`issues.status.${c}`) }))
  return (
    <Dialog open={!!status} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{status === "new" ? t("settings.addStatus") : t("settings.editStatus")}</DialogTitle>
          <DialogDescription>{t("settings.categoryHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="st-name-en">{t("settings.statusNameEn")}</FieldLabel>
            <Input id="st-name-en" dir="ltr" lang="en" maxLength={60} autoFocus={locale !== "ar"} value={en} onChange={(e) => setEn(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="st-name-ar">{t("settings.statusNameAr")}</FieldLabel>
            <Input id="st-name-ar" dir="rtl" lang="ar" maxLength={60} autoFocus={locale === "ar"} value={ar} onChange={(e) => setAr(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="st-cat">{t("settings.category")}</FieldLabel>
          <Select items={catItems} value={category} onValueChange={(v) => setCategory(String(v ?? "in_progress"))}>
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
        <Field>
          <FieldLabel id="st-icon">{t("settings.statusIcon")}</FieldLabel>
          <div role="radiogroup" aria-labelledby="st-icon" className="flex flex-wrap gap-1.5" data-status-icons>
            {Object.keys(STATUS_ICONS).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={shown === name}
                aria-label={name}
                title={name}
                onClick={() => setIcon(name === STAGE_ICON[category] ? "" : name)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-nq-focus",
                  shown === name && "border-border bg-muted",
                )}
              >
                <StatusIcon status={{ icon: name, color: shown === name ? color : undefined }} />
              </button>
            ))}
          </div>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!name}
            onClick={() => onSave({ name, labels: { en: en.trim(), ar: ar.trim() }, icon, color, stage: category })}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

