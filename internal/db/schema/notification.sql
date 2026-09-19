-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- The per-user in-app inbox (plan, "Notifications"). Mahaam's own table, not togo
-- notification-center (in-memory store, user from X-User-Id). kind + data drive the localised text
-- in the UI; title/body are a fallback in the workspace language. dedupe_key makes a reminder job
-- idempotent: one row per (workspace, user, kind, key) — e.g. one "no time today" per day.
-- P2 writes timer.long_running and time.missing_day; email delivery is not wired yet.
CREATE TABLE IF NOT EXISTS notifications (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    user_id      text NOT NULL,
    kind         text NOT NULL CHECK (kind ~ '^[a-z_]+(\.[a-z_]+)*$'),
    title        text NOT NULL,
    body         text,
    url          text,
    data         text NOT NULL DEFAULT '{}',
    dedupe_key   text,
    read_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
