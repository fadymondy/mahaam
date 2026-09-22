-- Email verification (MH-342): when the account proved it can read its address. NULL = not yet.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- One-off: every account that exists before verification does counts as verified. They have been
-- signing in and working for as long as Mahaam has existed; gating them now behind a code that,
-- until SMTP is configured, can't even be delivered would lock out the people already using it.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_meta WHERE key = 'email_verified_grandfathered') THEN
        INSERT INTO platform_users (user_id, email_verified_at, updated_at)
        SELECT id, now(), now() FROM users
        ON CONFLICT (user_id) DO UPDATE SET email_verified_at = coalesce(platform_users.email_verified_at, now());
        INSERT INTO platform_meta (key, value) VALUES ('email_verified_grandfathered', 'accounts before MH-342 marked verified');
    END IF;
END $$;
