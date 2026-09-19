"use client"

import { useState, type FormEvent } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionHeader } from "@/components/public-frame"
import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, useLabels, useTeams, w } from "@/lib/work"

/*
Who sees what (internal/work/access.go). Managers and up see every project. An employee
sees a project when it is workspace-visible, they or their team are on it, they or their
team hold a grant on a LABEL the project carries, or they hold a TASK grant in it (then only
those tasks). Labels are put on projects in each project's settings.
*/

type Grant = {
  id: string
  subject_type: "user" | "team"
  subject_id: string
  subject_name: string
  scope_type: "label" | "task"
  scope_id: string
  scope_name: string
  created_at: string
}

const selectCls = "h-8 w-full rounded-lg border border-line bg-transparent px-2 text-sm"

export default function AccessPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("access.title")} · ${ws.summary.name}`)
  const canManage = ws.can("access:manage")
  const grants = useSWR<{ grants: Grant[] | null }>(canManage ? ["/api/w/access-grants", ws.id] : null, ([p, id]: [string, string]) =>
    api(p, { workspaceId: id }),
  )
  const dir = useDirectory()
  const teams = useTeams(ws.id)
  const labels = useLabels(ws.id)
  const [subjectType, setSubjectType] = useState<"user" | "team">("team")
  const [subject, setSubject] = useState("")
  const [scopeType, setScopeType] = useState<"label" | "task">("label")
  const [scope, setScope] = useState("")
  const [busy, setBusy] = useState(false)

  if (!canManage) return <EmptyState title={t("access.managersOnly")} />

  const employees = dir.members.filter((m) => m.role !== "client")

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!subject || !scope.trim()) return
    setBusy(true)
    try {
      await w.post(ws.id, "/api/w/access-grants", { subject_type: subjectType, subject, scope_type: scopeType, scope: scope.trim() })
      toast.success(t("access.granted"))
      setScope("")
      void grants.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const list = grants.data?.grants ?? []

  return (
    <div className="space-y-6 p-6">
      <SectionHeader title={t("access.title")} description={t("access.description")} />

      <form onSubmit={add} className="grid gap-3 border border-line p-4 md:grid-cols-[repeat(4,minmax(0,1fr))_auto] md:items-end">
        <Field>
          <FieldLabel htmlFor="g-subject-type">{t("access.who")}</FieldLabel>
          <select
            id="g-subject-type"
            className={selectCls}
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value as "user" | "team")
              setSubject("")
            }}
          >
            <option value="team">{t("access.team")}</option>
            <option value="user">{t("access.employee")}</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="g-subject">{subjectType === "team" ? t("access.team") : t("access.employee")}</FieldLabel>
          <select id="g-subject" className={selectCls} value={subject} onChange={(e) => setSubject(e.target.value)} required>
            <option value="">{t("access.choose")}</option>
            {subjectType === "team"
              ? (teams.data?.teams ?? []).map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))
              : employees.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.email}
                  </option>
                ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="g-scope-type">{t("access.what")}</FieldLabel>
          <select
            id="g-scope-type"
            className={selectCls}
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value as "label" | "task")
              setScope("")
            }}
          >
            <option value="label">{t("access.labelScope")}</option>
            <option value="task">{t("access.taskScope")}</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="g-scope">{scopeType === "label" ? t("access.label") : t("access.taskKey")}</FieldLabel>
          {scopeType === "label" ? (
            <select id="g-scope" className={selectCls} value={scope} onChange={(e) => setScope(e.target.value)} required>
              <option value="">{t("access.choose")}</option>
              {(labels.data?.labels ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : (
            <Input id="g-scope" dir="ltr" placeholder="MH-12" value={scope} onChange={(e) => setScope(e.target.value)} required />
          )}
        </Field>
        <Button type="submit" disabled={busy}>
          <PlusIcon /> {t("access.grant")}
        </Button>
      </form>

      {grants.error ? (
        <ErrorState error={grants.error} />
      ) : !grants.data ? (
        <LoadingRows rows={3} />
      ) : list.length === 0 ? (
        <EmptyState title={t("access.empty")} body={t("access.emptyBody")} />
      ) : (
        <ul className="divide-y divide-line border border-line">
          {list.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
              <Badge variant="secondary">{g.subject_type === "team" ? t("access.team") : t("access.employee")}</Badge>
              <span className="font-medium" dir="auto">
                {g.subject_type === "user" ? dir.name(g.subject_id) : g.subject_name}
              </span>
              <span className="text-grid-muted">→</span>
              <Badge variant="outline">{g.scope_type === "label" ? t("access.labelScope") : t("access.taskScope")}</Badge>
              <span dir="auto">{g.scope_name}</span>
              <span className="ms-auto">
                <ConfirmButton
                  label={
                    <>
                      <Trash2Icon /> {t("access.revoke")}
                    </>
                  }
                  title={t("access.revokeTitle")}
                  description={t("access.revokeBody")}
                  confirmLabel={t("access.revoke")}
                  onConfirm={() =>
                    w
                      .del(ws.id, `/api/w/access-grants/${g.id}`)
                      .then(() => void grants.mutate())
                      .catch((err) => void toast.error(errorText(err, t("common.networkError"))))
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
