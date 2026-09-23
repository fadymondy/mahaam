-- One-time codes mailed to a person: password reset, email verification and change, and 'reauth' (the
-- password stand-in for accounts without one, internal/account/reauth.go) (MH-340,
-- MH-342). Not tenant data. An account exists outside any workspace, so this runs on the owner
-- pool only (internal/account) with no RLS policy and no grant to the app role.
CREATE TABLE IF NOT EXISTS account_codes (
    id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    text        NOT NULL CHECK (purpose IN ('password_reset', 'email_verify', 'email_change', 'reauth')),
    -- HMAC of purpose, user and code under MAHAAM_SECRET_KEY, never the code itself. A six-digit
    -- code has a million values, so a plain hash would fall to a laptop in a second if this table
    -- leaked. Keyed, it is useless without the server's key as well.
    code_hash  text        NOT NULL,
    -- What the code is for, when that is more than "this user": the new address for email_change.
    target     text        NOT NULL DEFAULT '',
    attempts   integer     NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one live code per person per purpose. Asking again replaces the old one, so a code from
-- an earlier email stops working the moment a newer one is sent.
CREATE UNIQUE INDEX IF NOT EXISTS account_codes_live ON account_codes (user_id, purpose) WHERE used_at IS NULL;
