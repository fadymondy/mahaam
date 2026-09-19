-- P8.5 (owner feedback): what a project's customer sees in the portal, per project.
--
--   share_board  the task board read-only: titles, columns, due dates, assignees, labels,
--                description and checklist progress (never task comments)   default ON
--   share_team   the names of the people on the project (never rates)        default ON
--   share_money  the money budget (budget_minor, currency)                   default OFF
--
-- And the request cycle's bookkeeping on reports (a request's decision and the task it became):
--   request_task_key     the task key a converted request became
--   request_decided_at   when it was accepted / declined / converted (NULL while pending)
--   request_decided_by   who decided
--
-- Columns only: RLS on projects and reports already covers them (20_rls.sql); no new table,
-- so tenant.TenantTables is unaffected.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_board boolean NOT NULL DEFAULT true;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_team  boolean NOT NULL DEFAULT true;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_money boolean NOT NULL DEFAULT false;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_task_key   text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_decided_at timestamptz;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_decided_by text;
-- The request's state history, appended on every decision and reopen:
-- [{"state": "accepted", "at": "...", "by": "<user id>", "note": "..."}]. Filing is created_at.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: requests converted before request_task_key existed name their task in the reply.
UPDATE reports SET request_task_key = substring(request_reply FROM 'Planned as task ([A-Za-z0-9]+-[0-9]+)')
 WHERE request_state = 'converted' AND request_task_key IS NULL AND request_reply LIKE 'Planned as task %';
