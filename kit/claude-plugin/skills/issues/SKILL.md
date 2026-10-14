---
name: issues
description: Work a Mahaam project's issue queue — answer mentions, take the top issue in board order, post a plan, implement, verify, and close it with evidence. Use when asked to "work the issues", "check the board", "run the issues loop", or to fix a Mahaam issue by key (e.g. MH-42). Arguments: [project] [strategy].
---

# Work the issue queue

You take issues off a Mahaam board, implement them in this repo, and report back **on the issue**,
so the thread is the record, not the chat. The clock runs while an issue is in progress and the
plugin banks its tokens and cost when you close it.

Arguments: `[project] [strategy]`. Without a project, use `.mahaam.json` (announced at session
start); else ask. Strategy defaults to `.mahaam.json`'s `strategy`, else `sequential`.

## 1. Read the queue

- `list_mentions { project }`: human comments addressed to `@agent` / `@claude` / `@ai` with no agent reply yet
- `list_issues { project, state: "open" }`: board order (the owner's drag order); `human_only` is hidden
- `get_issue { key }`: body, captured route/page/selector, console and network logs, screenshot, thread

## 2. Choose

- **Mentions first.** Answer with `comment_issue { key, body, as_agent: true }` or do what they ask.
- **Board order, top of the column first.** `in_progress`, then `todo`, then `backlog`. Never re-sort by
  priority or taste. Skip `in_review` and `waiting_approval` — they wait on a human.
- **Never start a `human_only` issue.** Commenting on one is fine.
- **Honour the issue's settings**: if it names an agent, skill, model or effort, use them.
- **Ambiguous, needs a product decision, or destructive?** Comment what you need and move on.
- Secrets never go on an issue — use the vault tools (`vault_store_secret`) or ask.

| Strategy | Meaning |
|---|---|
| `sequential` | One issue at a time until one is finished. |
| `parallel` | Up to 3 **unrelated** issues at once, one `mahaam:issue-worker` agent each. Related = same file/component/table, same bug, or schema dependency. |
| `drain` | Keep going in board order until nothing actionable is left. |
| `mentions` | Only answer mentions. |
| `triage` | Don't implement: a short diagnosis + plan comment on each new backlog issue. |

## 3. Plan, then start

`start_issue { key, plan }` posts the plan, moves the issue to `in_progress` and starts the clock.
A plan names the files you'll change, the approach, and how you'll verify it. Read the repo's
CLAUDE.md first.

## 4. Implement and verify

Use the captured context (route, selector, logs, screenshot) to reproduce. Verification is running
the real thing — tests, the page in a browser, the real request — not only a typecheck.

## 5. Close with evidence (each stops the clock)

- `review_issue { key, note }` — done and verified; the note says what changed, where, and how you verified. **The normal ending.**
- `request_approval { key, question }` — blocked or partial; give the options and the one you'd pick.
- `finish_issue { key, resolution }` — only for work a human already accepted.

Never mark unfinished work `in_review` or `done`. Split instead: `create_issue` for the rest, mention
its key, then close the part you finished.

When a close returns a Mahaam note asking you to call `record_issue_usage`, do it with exactly the
numbers given — that is the issue's AI cost.

## 6. Report

One short paragraph per issue: key, what changed, how it was verified, what's left.
