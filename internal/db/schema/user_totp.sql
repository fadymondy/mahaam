-- Two-factor sign-in (MH-341): an authenticator app's TOTP, and one-time recovery codes. Owner pool
-- only, no RLS and no grant to the app role, like every account-level table. The auth plugin's own
-- auth_totp table is not used: it keeps the secret in plain text, and its routes are blocked.
CREATE TABLE IF NOT EXISTS user_totp (
    user_id       text        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- secretbox.Seal of the base32 secret: whoever reads the table can't mint codes without the
    -- server key as well.
    secret_sealed text        NOT NULL,
    -- NULL while enrolling (the QR is shown, no code confirmed yet); sign-in asks for a code only
    -- once this is set.
    enabled_at    timestamptz,
    -- The last 30-second step a code was accepted for. A code is valid for its window, so without
    -- this one code overheard or shoulder-surfed could be used twice.
    last_step     bigint      NOT NULL DEFAULT 0,
    -- Wrong codes in the current window, counted here rather than in memory so the limit holds
    -- across API instances.
    failures      integer     NOT NULL DEFAULT 0,
    failures_reset_at timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- HMAC under MAHAAM_SECRET_KEY, like account_codes.
    code_hash  text        NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_recovery_codes_user ON user_recovery_codes (user_id) WHERE used_at IS NULL;
