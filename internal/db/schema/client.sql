-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
CREATE TABLE IF NOT EXISTS clients (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    name               text NOT NULL CHECK (length(btrim(name)) > 0),
    email              text,
    phone              text,
    country            text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    currency           text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    default_rate_minor bigint CHECK (default_rate_minor IS NULL OR default_rate_minor >= 0),
    notes              text,
    archived_at        timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
