-- Account deletion (MH-344). Account-level state, so it sits on platform_users (owner pool only)
-- next to suspension and forced sign-out.
--
--   deletion_requested_at  the person asked; the account is signed out everywhere from then
--   purge_after            when the reaper anonymises it, unless they sign in before then
--   deleted_at             the reaper ran: the users row is kept but no longer identifies anyone
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS purge_after timestamptz;
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The reaper's one question: whose grace period is over.
CREATE INDEX IF NOT EXISTS platform_users_purge_idx ON platform_users (purge_after)
    WHERE purge_after IS NOT NULL AND deleted_at IS NULL;
