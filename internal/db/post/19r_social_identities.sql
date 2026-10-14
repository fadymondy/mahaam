-- Google and GitHub sign-ins keep their subject in user_identities too (internal/account/identities.go),
-- so a repeat sign-in finds its account by (provider, subject) even after the email changes. The
-- table was created allowing only 'apple'; widen the check on databases made before.
ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_provider_check;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_check
    CHECK (provider IN ('apple', 'google', 'github'));
