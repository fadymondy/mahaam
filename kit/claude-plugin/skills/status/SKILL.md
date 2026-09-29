---
name: status
description: Write a Mahaam project status report or standup — what moved, what's in review, what's blocked, time and AI spent. Use when the user asks for "status", "standup", "weekly report", "what happened on project X", or a client update.
---

# Project status

Default window: since the last working day for a standup, the last 7 days for a weekly report.

Gather (skip what the token's role can't read — say so in one line, don't fail):

1. `get_project { project }` — name, client, dates, budget.
2. `project_activity { project, limit }` — what changed and who changed it.
3. `list_issues { project, state: "open" }` — group by status; `waiting_approval` = needs a decision.
4. `list_tasks { project }` — overdue and unassigned work.
5. `time_summary { from, to, projects: [project], group_by: "member" }` — human time.
6. `ai_usage_summary { project, from, to, group_by: "model" }` — AI spend (manager+).
7. `budget_status { project }` (manager+).

Write it in this shape, short:

- **Done** — keys + one line each.
- **In review** — keys waiting on a human, with who should look.
- **Needs a decision** — each `waiting_approval` question in one line.
- **Next** — top 3 of the board.
- **Risks** — overdue, over budget, blocked.
- **Time & cost** — hours by person, AI cost, budget used %.

For a client update, drop internal names, costs and markup unless asked, and offer
`export_project_report` for a PDF/CSV.
