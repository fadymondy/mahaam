"use client"

import { useEffect, useState } from "react"

import type { IssueDetail } from "../../types"
import { Button } from "./button"
import { Markdown } from "./markdown"
import { Textarea } from "./textarea"

/**
 * One issue, in a 380px popover.
 *
 * What it does: the body as markdown, the comment thread, adding a comment, and moving the issue
 * between workflow stages. That is the set of things you actually want to do without leaving
 * whatever you were doing — read it, say something, move it on.
 *
 * What it deliberately does not do: edit the title or the body. Inline editing of a markdown body
 * in a column this narrow is worse than the hand-off to the web app, which is one tap away and has
 * room for it. Half an editor would be the worst of both.
 */

export interface IssueDetailStrings {
  back: string
  loading: string
  failed: string
  retry: string
  noBody: string
  comments: string
  noComments: string
  commentPlaceholder: string
  send: string
  sending: string
  openInApp: string
  moveTo: string
  agent: string
  status: Record<string, string>
}

/** Workflow stages a person can move an issue to from here. */
const STAGES = ["backlog", "todo", "in_progress", "in_review", "done"] as const

export function IssueDetailView({
  issueKey,
  strings,
  load,
  comment,
  move,
  onBack,
  onOpenExternal,
}: {
  issueKey: string
  strings: IssueDetailStrings
  load: (key: string) => Promise<IssueDetail>
  comment: (key: string, body: string) => Promise<unknown>
  move: (key: string, status: string) => Promise<unknown>
  onBack: () => void
  onOpenExternal: (key: string) => void
}) {
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setIssue(null)
    setFailed(false)
    load(issueKey).then(
      (i) => live && setIssue(i),
      // A panel that shows a spinner for ever is the worst outcome: nothing to read and nothing
      // to do about it.
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [issueKey, load])

  async function send() {
    const body = draft.trim()
    if (!body || busy) return // a double tap must not post twice
    setBusy(true)
    try {
      await comment(issueKey, body)
      setDraft("")
      setIssue(await load(issueKey)) // refetch rather than guess what the server stored
    } catch {
      // Keep the draft. Losing what someone typed because the network blinked is unforgivable in
      // a popover they may have spent a minute in.
    } finally {
      setBusy(false)
    }
  }

  async function moveTo(status: string) {
    if (busy || !issue || status === issue.status) return
    setBusy(true)
    try {
      await move(issueKey, status)
      setIssue(await load(issueKey))
    } catch {
      /* the stage buttons still show the server's last known value */
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div className="mgy-bar">
      <Button variant="link" className="h-auto p-0 justify-start" onClick={onBack}>
        ← {strings.back}
      </Button>
      <span className="mgy-spacer" />
      <span className="mgy-mono mgy-muted">{issueKey}</span>
    </div>
  )

  if (failed) {
    return (
      <section className="mgy-page">
        {header}
        <p className="mgy-muted">{strings.failed}</p>
        <Button size="sm" variant="outline" onClick={() => setIssueKeyRetry(setIssue, setFailed, load, issueKey)}>
          {strings.retry}
        </Button>
      </section>
    )
  }

  if (!issue) {
    return (
      <section className="mgy-page">
        {header}
        <p className="mgy-muted">{strings.loading}</p>
      </section>
    )
  }

  const comments = issue.comments ?? []

  return (
    <section className="mgy-page mgy-issue">
      {header}

      <h1 className="mgy-issue-title">{issue.title}</h1>

      <div className="mgy-row mgy-issue-meta">
        <span className="mgy-chip">{strings.status[issue.status] ?? issue.status}</span>
        {issue.priority ? <span className="mgy-chip mgy-muted">{issue.priority}</span> : null}
        {/* Agent time is on the issue, and seeing it here is half the point of an agent board. */}
        {issue.agent_seconds > 0 ? (
          <span className="mgy-muted mgy-mono">
            {strings.agent} {Math.round(issue.agent_seconds / 60)}m
          </span>
        ) : null}
      </div>

      <div className="mgy-issue-body">
        {issue.body?.trim() ? (
          <Markdown source={issue.body} onOpen={(url) => onOpenExternal(url)} />
        ) : (
          <p className="mgy-muted">{strings.noBody}</p>
        )}
      </div>

      <h2 className="mgy-h">{strings.moveTo}</h2>
      <div className="mgy-row mgy-wrap">
        {STAGES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === issue.status ? "default" : "outline"}
            disabled={busy || s === issue.status}
            onClick={() => void moveTo(s)}
          >
            {strings.status[s] ?? s}
          </Button>
        ))}
      </div>

      <h2 className="mgy-h">
        {strings.comments} <span className="mgy-mono mgy-muted">{comments.length}</span>
      </h2>
      {comments.length === 0 ? (
        <p className="mgy-muted">{strings.noComments}</p>
      ) : (
        <ul className="mgy-list mgy-comments">
          {comments.map((c) => (
            <li key={c.id} className="mgy-comment">
              <div className="mgy-muted mgy-comment-meta">
                {c.author_kind === "agent" ? strings.agent : (c.author_id ?? "")}
                <span className="mgy-spacer" />
                <time dateTime={c.created_at}>{new Date(c.created_at).toLocaleDateString()}</time>
              </div>
              <Markdown source={c.body} onOpen={(url) => onOpenExternal(url)} />
            </li>
          ))}
        </ul>
      )}

      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={strings.commentPlaceholder}
        aria-label={strings.comments}
        rows={3}
        disabled={busy}
      />
      <div className="mgy-row">
        <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void send()}>
          {busy ? strings.sending : strings.send}
        </Button>
        <span className="mgy-spacer" />
        <Button size="sm" variant="ghost" onClick={() => onOpenExternal(issueKey)}>
          {strings.openInApp}
        </Button>
      </div>
    </section>
  )
}

/** Retry without remounting: clears the failure and asks again. */
function setIssueKeyRetry(
  setIssue: (i: IssueDetail | null) => void,
  setFailed: (b: boolean) => void,
  load: (key: string) => Promise<IssueDetail>,
  key: string,
): void {
  setFailed(false)
  setIssue(null)
  load(key).then(setIssue, () => setFailed(true))
}
