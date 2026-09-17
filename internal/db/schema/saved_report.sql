-- Hand-written Postgres DDL (togo make:resource emits SQLite; README note 1).
-- A saved report view (plan, "Reports"): the filters of the reports page under a name. Its owner
-- edits it; shared = every member of the workspace can open it. Opening a shared view never grants
-- more than the caller's role: the report endpoints apply their own checks (a member's time report
-- is their own time; profitability is manager+).
-- kind: time | budget | profitability. filters: JSON object (internal/work/reports.go, ReportQuery).
-- FKs, uniques and RLS: internal/db/post (13_p5_constraints.sql, 23_rls_p5.sql).
CREATE TABLE IF NOT EXISTS saved_reports (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    owner_id     text NOT NULL,
    name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    kind         text NOT NULL DEFAULT 'time' CHECK (kind IN ('time','budget','profitability')),
    filters      text NOT NULL DEFAULT '{}' CHECK (length(filters) <= 8000),
    shared       boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
