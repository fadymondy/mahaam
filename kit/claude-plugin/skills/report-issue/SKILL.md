---
name: report-issue
description: File a well-formed Mahaam issue from what you just found — a bug, a follow-up, a TODO, or the unfinished half of a task. Use when the user says "file an issue", "log this bug in Mahaam", "add a task for that", or when you split work you can't finish now.
---

# File an issue

1. **Deduplicate.** `list_issues { project, q: "<3-4 key words>" }`. If one matches, `comment_issue`
   on it with the new evidence instead of filing a twin.
2. **Write it so someone else can act without asking:**
   - `title`: the symptom or outcome, ≤ 80 chars ("Checkout button does nothing on Safari").
   - `body` (Markdown): **What happens**, **Expected**, **Steps / where** (file:line, route, command),
     **Evidence** (error text, log lines), **Notes** (suspected cause, related keys).
   - `issue_type`: `bug` | `feature` | `task` | `story` | `epic`.
   - `priority`: `highest` … `lowest` — only `high`+ if it blocks users or other work.
   - `status`: `backlog` unless the user wants it scheduled (`todo`).
3. `create_issue { project, title, body, issue_type, priority, status }` and give the user the key.
4. If it came out of a split, mention the new key on the original issue (`comment_issue`).

Never paste secrets, tokens or customer personal data into an issue.
