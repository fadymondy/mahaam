"use client"

import { useState, type FormEvent } from "react"

import { useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { errorText, issuesApi, type IssueComment } from "@/lib/work"

/** Posting a comment: shared by the sheet and the full page. Mentions are parsed server-side. */
export function useCommentForm(issueKey: string | undefined, onPosted: () => void | Promise<unknown>) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [value, setValue] = useState("")
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!issueKey || !value.trim()) return
    setPosting(true)
    setError(null)
    try {
      await issuesApi.comment(ws.id, issueKey, value.trim())
      setValue("")
      await onPosted()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setPosting(false)
    }
  }

  return { value, setValue, posting, error, submit, canWrite: ws.can("feedback:write") }
}

/** Who wrote a comment: a member's name, or the agent / admin kind. */
export function useCommentAuthor() {
  const { t } = useTranslations()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  return (c: IssueComment) =>
    c.author_kind === "user" && c.author_id ? dir.name(c.author_id) : t(`issues.kind.${["agent", "admin"].includes(c.author_kind) ? c.author_kind : "user"}`)
}
