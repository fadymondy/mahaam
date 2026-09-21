-- Hand-written Postgres DDL (togo make:resource emits SQLite; README note 1).
-- One person's notification settings in one workspace (P5). No row = the defaults below.
--   email_enabled   each notification is also sent by email (togo mail)
--   digest_enabled  a daily summary email at digest_hour, local to the workspace timezone
--   muted_kinds     comma-separated notification kinds that are neither stored nor emailed
--   last_digest_on  the local day the last digest went out — the digest job's idempotency key
-- FKs, uniques and RLS: internal/db/post (13_p5_constraints.sql, 23_rls_p5.sql).
CREATE TABLE IF NOT EXISTS notification_prefs (
    id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id   text NOT NULL,
    user_id        text NOT NULL,
    email_enabled  boolean NOT NULL DEFAULT true,
    digest_enabled boolean NOT NULL DEFAULT true,
    digest_hour    bigint NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
    muted_kinds    text NOT NULL DEFAULT '' CHECK (muted_kinds ~ '^[a-z_.,]*$'),
    last_digest_on date,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- P5: email delivery state of an inbox item. NULL = not processed yet;
-- sending | sent | skipped | failed.
--
-- 'sending' is the CLAIM, added with MH-249: it means a runner owns this row
-- right now, which is a different fact from 'skipped' (a decision not to mail
-- it). Without the distinction, a process that died mid-send left a row that
-- looked deliberately skipped — a mail nobody sent and nobody could find.
-- When the column is first added, the existing items are marked skipped: they predate email and are
-- not mailed retroactively.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'email_status') THEN
        ALTER TABLE notifications ADD COLUMN email_status text CHECK (email_status IS NULL OR email_status IN ('sending','sent','skipped','failed'));
        UPDATE notifications SET email_status = 'skipped';
    END IF;
END $$;
-- The same column again, for sqlc (it does not read DO blocks); a no-op once the block has run.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_status text CHECK (email_status IS NULL OR email_status IN ('sending','sent','skipped','failed'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
