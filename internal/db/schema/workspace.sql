-- Hand-written Postgres DDL for the Workspace resource (togo.resources.yaml).
-- togo CLI 0.2.31 `make:resource` emits a SQLite fragment here (randomblob,
-- datetime, `?` placeholders) even in a `--db postgres` project — see README,
-- "togo framework notes". Column names and types follow the manifest exactly.
--
-- A workspace is the tenant. It is the one table whose RLS policy keys on `id`
-- rather than `workspace_id` (internal/db/post/20_rls.sql).
CREATE TABLE IF NOT EXISTS workspaces (
    id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    slug             text        NOT NULL UNIQUE,
    name             text        NOT NULL,
    locale           text        NOT NULL DEFAULT 'en',
    timezone         text        NOT NULL DEFAULT 'UTC',
    currency         text        NOT NULL DEFAULT 'USD',
    week_start       bigint      NOT NULL DEFAULT 1,
    rounding_minutes bigint      NOT NULL DEFAULT 0,
    settings         text,
    plan             text        NOT NULL DEFAULT 'free',
    created_by       text        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- P2: time settings and default rates (minor units, workspace currency). week_start: 0 = Sunday …
-- 6 = Saturday. rounding_minutes applies at report time only. reminder_running_hours: a running
-- timer older than this raises an in-app reminder; reminder_daily: "no time logged by 18:00 local".
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_bill_rate_minor bigint CHECK (default_bill_rate_minor IS NULL OR default_bill_rate_minor >= 0);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_cost_rate_minor bigint CHECK (default_cost_rate_minor IS NULL OR default_cost_rate_minor >= 0);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS reminder_running_hours bigint NOT NULL DEFAULT 8 CHECK (reminder_running_hours BETWEEN 1 AND 24);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS reminder_daily boolean NOT NULL DEFAULT true;
