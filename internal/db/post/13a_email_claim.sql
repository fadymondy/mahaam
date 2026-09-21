-- MH-249: 'sending' is a valid email_status.
--
-- The column's own CHECK was created with the original three values, and
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS does not revisit a constraint on a
-- column that already exists — so a database created before this keeps the old
-- rule and refuses the claim. This replaces it, and is idempotent: every post
-- file is replayed on every deploy.
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'notifications'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%email_status%'
    LOOP
        IF c.def LIKE '%sending%' THEN
            RETURN; -- already widened; nothing to do
        END IF;
        EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE notifications ADD CONSTRAINT notifications_email_status_check
        CHECK (email_status IS NULL OR email_status IN ('sending','sent','skipped','failed'));
END $$;

-- Anything left claimed by a process that died before this shipped is put back,
-- so it is tried again rather than sitting in a state nobody looks at.
UPDATE notifications SET email_status = NULL
WHERE email_status = 'sending' AND updated_at < now() - interval '1 hour';
