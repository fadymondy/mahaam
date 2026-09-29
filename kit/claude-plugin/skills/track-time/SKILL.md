---
name: track-time
description: Track human time in Mahaam — start/stop a timer on a task, log time after the fact, fix entries, and read timesheets and summaries. Use when the user says "start a timer", "log 2h on X", "what did I work on this week", or "timesheet".
---

# Track time

Mahaam keeps one running timer per person. Rates are snapshotted when an entry is created; rounding
happens only in reports. Days are cut at midnight in the workspace timezone.

| Want | Tool |
|---|---|
| What's running? | `get_running_timer` |
| Start on a task | `start_timer { task, project?, description?, billable? }` — stops nothing silently: if one runs, say so and ask |
| Stop | `stop_timer` |
| Log after the fact | `log_time { task, date + minutes \| started_at + ended_at, description, billable? }` |
| Fix / delete | `update_time_entry`, `delete_time_entry` (only unlocked, un-invoiced entries) |
| My week | `timesheet { week }` |
| Totals by project/person/day | `time_summary { from, to, group_by, projects?, users? }` |
| Export | `export_time_report` |

Rules:
- Resolve "the login bug" to a task key with `list_tasks { project, q }` and confirm if more than one matches.
- Times are ISO 8601 with offset; use the user's local time zone, never guess UTC.
- Overlapping entries are refused by the database — report the clash instead of shifting times.
- Agent time on issues is automatic (it runs while an issue is `todo`/`in_progress`); don't log it by hand.
