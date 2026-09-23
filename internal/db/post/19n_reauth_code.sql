-- 'reauth' is a valid account_codes purpose (internal/account/reauth.go): the mailed code that stands
-- in for a password on accounts made with Apple, Google or GitHub.
--
-- The column's CHECK was created with the first three purposes, and CREATE TABLE IF NOT EXISTS does
-- not revisit it on a database that already has the table. This replaces it, and is idempotent:
-- every post file is replayed on every deploy (same pattern as 13a_email_claim.sql).
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'account_codes'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%purpose%'
    LOOP
        IF c.def LIKE '%reauth%' THEN
            RETURN; -- already widened
        END IF;
        EXECUTE format('ALTER TABLE account_codes DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE account_codes ADD CONSTRAINT account_codes_purpose_check
        CHECK (purpose IN ('password_reset', 'email_verify', 'email_change', 'reauth'));
END $$;
