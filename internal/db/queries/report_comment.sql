-- Postgres queries for report_comments (tenant predicate required).

-- name: ListReportComments :many
SELECT * FROM report_comments WHERE workspace_id = $1 AND report_id = $2 ORDER BY created_at ASC;
