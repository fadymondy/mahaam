---
name: issues
description: Pull the next actionable issue off a Mahaam project's board and implement it. Use when asked to work the issue queue, check for new reports, or run the issues loop. Takes an optional project name and strategy (e.g. "/issues Acme Website parallel").
---

# Work the issue queue

Ported from fadymondy.com-v2's `/issues` loop. The same protocol, on Mahaam's user MCP, so it works
in **any repo connected to a Mahaam project**, including Mahaam itself. You take issues off the
board, implement them, and report back on the issue, so the thread is the record, not the chat.

Arguments: `[project] [strategy]`. `project` is a project name or id. If it's omitted, use the
project named in this repo's CLAUDE.md/README, or else work the whole workspace. `strategy` is
described in section 2.

## 1. Read the queue

Use the Mahaam MCP tools. The server is registered as `mahaam` (`POST <MAHAAM_URL>/api/mcp`, Bearer
`mgy_…` token with `issues:read issues:write projects:read`, minted in Mahaam → Workspace → MCP tokens):

- `list_mentions { project }`: unanswered comments addressed to `@agent` / `@claude` / `@ai`
- `list_issues { project, state: "open" }`: board order, with `human_only` hidden
- `get_issue { key }`: the full body, the captured page/route/selector, console and network logs,
  the screenshot link, and the comment thread

**If those tools aren't loaded** (MCP servers attach only at session start), call the same tools over
JSON-RPC with the token from the MCP config:

```bash
curl -s -X POST "$MAHAAM_URL/api/mcp" -H "Authorization: Bearer $MAHAAM_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_issues","arguments":{"state":"open"}}}'
```

## 2. Choose what to work on, and the strategy

Every pass must end with something finished.

**Check `list_mentions` first.** If a human asked the agent something on a comment and has had no
agent reply since, that outranks the board. Answer it, or do the work it asks for, before taking
the top of the column. Reply with `comment_issue { key, body, as_agent: true }`, which clears the
mention.

**Take them in board order, top of the column first.** `list_issues` already returns that order
(`sort_order ASC`), and it is the owner's, set by dragging cards on the Issues board. Do **not**
re-sort by priority, key or interest. Work `in_progress` before `todo` before `backlog`. Skip
`in_review` and `waiting_approval`: those are waiting on a human, not on you.

**Never work a `human_only` issue.** `list_issues` hides them and `start_issue` refuses them. Reading
one and leaving a useful comment is fine; starting it is not.

**Honour the issue's own strategy.** If `get_issue` shows an agent, skill, model or effort set on the
issue, use it: run that subagent or skill for the issue, at that model or effort.

**Strategy for the run** (the argument; default `sequential`):

| Strategy | What it does |
|---|---|
| `sequential` | One issue at a time from the top, until one is finished (the floor). |
| `parallel` | Up to **three unrelated** issues at once, one subagent each (Agent tool). Each subagent runs this whole protocol for its own issue. |
| `mentions` | Only answer `list_mentions`, then stop. |
| `drain` | Keep going in board order until nothing actionable is left or the session budget runs out. |
| `triage` | Don't implement. Comment a short diagnosis and plan on each new `backlog` issue and `reorder_issue` them if asked. |

Two issues are **related**, and must be done sequentially, when they touch the same file, component
or table, are the same bug reported twice, depend on each other's schema, or both need the same
server rebuilt. Backend and frontend of the same feature are sequential; unrelated UI polish can run
in parallel. When in doubt, sequential.

**Skip and comment instead of guessing** when an issue is ambiguous, needs a product decision, or
would need a destructive change (dropping data, rewriting history, changing auth). Say what you'd
need to proceed. If nothing is actionable, say so plainly and stop. Do not invent work.

Secrets never belong on an issue. Ask for them in the project's vault instead.

## 3. Say what you are going to do, THEN do it

`start_issue { key, plan }` posts the plan as a comment, moves the issue to `in_progress`, and
starts the clock. It **refuses** without a plan. Post the plan before you touch code, so a human
can stop you if it's wrong.

A plan says what you are changing, in which files, and the one decision that could have gone
another way. "Implement the feature" is not a plan.

Read the repo's `CLAUDE.md` (and `TODO.md` if there is one) for its conventions before you start.

## 4. Implement

Use the issue's captured context; that is what it's for:

- `route` / `page_url`: where to reproduce it
- `selector`: the exact element reported
- `console_log` / `network_log`: what was happening at the time
- the screenshot: what it looked like

## 5. Verify before claiming

Typechecking is not verification. Build and typecheck, then **load the page and assert the real DOM
or computed style**, or run the real request. Measure animations in a visible tab.

## 6. Close the loop

Three endings. Each stops the clock and banks the time, and each requires evidence:

- `review_issue { key, note }` → **In review.** Implemented AND verified; only a human's opinion is
  left. This is the normal ending. The note says what changed, which files, and how it was verified.
- `finish_issue { key, resolution }` → **Done.** Only for work a human already accepted.
- `request_approval { key, question }` → **Waiting for approval.** You can't finish it; the question
  gives the options and the one you'd pick, so answering takes one word.

**NEVER move an issue to `in_review` or `done` with the task unfinished.** If you catch yourself
writing "what this does NOT do", "the data half" or "ready for when X lands", stop: the issue is
not finished. Partial or blocked work goes to `request_approval`. Splitting is allowed: file the
second part with `create_issue` and mention its key before closing the first. Silently shrinking
the scope is not allowed.

## 7. Report

One short paragraph per issue: which issue, what changed, how it was verified, and anything left
open. If you skipped everything, say why in one line.
