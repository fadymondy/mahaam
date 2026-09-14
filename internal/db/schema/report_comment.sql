-- Hand-written Postgres DDL for ReportComment (see workspace.sql for why).
-- Same columns as fadymondy.com-v2's ReportComment, plus workspace_id.
-- author_kind: user | agent | admin
CREATE TABLE IF NOT EXISTS report_comments (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text        NOT NULL,
    report_id    text        NOT NULL,
    author_id    text,
    author_kind  text        NOT NULL,
    body         text        NOT NULL,
    mentions     text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
