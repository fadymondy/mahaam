-- Sign-in identities (internal/account/identities.go): who a provider's stable subject is here.
-- Apple (`sub`, stable per Apple team), Google (`sub`) and GitHub (the numeric user id). The email a
-- provider reports may be a private relay address and can change, so the link is kept by subject,
-- not by email; the email only links an unseen subject, and only when the provider verified it.
-- (Existing databases get the wider provider list from post/19r_social_identities.sql.)
-- Platform data (not tenant-scoped): owner pool only, no RLS, no app-role grant, like every
-- account-level table. An account's links go when it is purged (account/delete.go).
CREATE TABLE IF NOT EXISTS user_identities (
    provider     text        NOT NULL CHECK (provider IN ('apple', 'google', 'github')),
    subject      text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    user_id      text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What the provider last said the address was (informational; users.email is the account's).
    email        text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities (user_id);

-- Sign in with Apple only: the refresh token from exchanging the authorization code, sealed with
-- secretbox, and the client id it was issued to (the bundle id for the app, the Services ID for the
-- web). Kept for one thing: revoking it when the account is deleted (POST /auth/revoke, App Store
-- guideline 5.1.1(v)). Empty when the Apple key isn't configured or the exchange failed.
ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS refresh_token text NOT NULL DEFAULT '';
ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS token_client_id text NOT NULL DEFAULT '';

-- Spent sign-in nonces: an identity token is accepted once. The nonce is the app's own random
-- value (its SHA-256 is inside the token), so a token and nonce lifted off a device or a log cannot
-- be replayed while the token is still unexpired. Rows are useless after expires_at and are swept
-- as new ones are written.
CREATE TABLE IF NOT EXISTS signin_nonces (
    nonce_hash text        PRIMARY KEY,
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS signin_nonces_expires ON signin_nonces (expires_at);
