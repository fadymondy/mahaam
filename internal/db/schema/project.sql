-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- status: planned | active | on_hold | completed | cancelled
-- billing_mode: non_billable | hourly | fixed. visibility: workspace | members.
-- color is a palette key (web/lib/palette.ts), never a raw colour.
CREATE TABLE IF NOT EXISTS projects (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    client_id      text,
    name           text NOT NULL CHECK (length(btrim(name)) > 0),
    description    text,
    color          text NOT NULL DEFAULT 'violet' CHECK (color ~ '^[a-z]+$'),
    status         text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
    billing_mode   text NOT NULL DEFAULT 'non_billable' CHECK (billing_mode IN ('non_billable','hourly','fixed')),
    budget_minutes bigint CHECK (budget_minutes IS NULL OR budget_minutes >= 0),
    budget_minor   bigint CHECK (budget_minor IS NULL OR budget_minor >= 0),
    currency       text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    visibility     text NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace','members')),
    starts_on      date,
    ends_on        date,
    archived_at    timestamptz,
    created_by     text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
