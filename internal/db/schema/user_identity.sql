-- Native sign-in identities (internal/account/apple.go): who a provider's stable subject is here.
-- Sign in with Apple identifies a person by `sub` (stable per Apple team); the email in its token
-- may be a private relay address and can change, so the link is kept by subject, not by email.
-- Google/GitHub go through the auth-oauth plugin, which matches by email and keeps no link.
-- Platform data (not tenant-scoped): owner pool only, no RLS, no app-role grant, like every
-- account-level table. An account's links go when it is purged (account/delete.go).
CREATE TABLE IF NOT EXISTS user_identities (
    provider     text        NOT NULL CHECK (provider IN ('apple')),
    subject      text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    user_id      text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What the provider last said the address was (informational; users.email is the account's).
    email        text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities (user_id);

-- Spent sign-in nonces: an identity token is accepted once. The nonce is the app's own random
-- value (its SHA-256 is inside the token), so a token and nonce lifted off a device or a log cannot
-- be replayed while the token is still unexpired. Rows are useless after expires_at and are swept
-- as new ones are written.
CREATE TABLE IF NOT EXISTS signin_nonces (
    nonce_hash text        PRIMARY KEY,
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS signin_nonces_expires ON signin_nonces (expires_at);
