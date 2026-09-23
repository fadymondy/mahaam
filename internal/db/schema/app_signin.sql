-- App sign-in (internal/account/appsignin.go): how the desktop and mobile apps sign in with
-- Google, GitHub or Apple — in the system browser, never an embedded one (RFC 8252). The browser
-- signs in on the web as usual; the signed-in page asks for a one-time code bound to the app's
-- PKCE challenge and redirects back to the app (a loopback port or mahaam://auth/callback); the
-- app trades code + verifier for its own device token. Platform data (not tenant-scoped): owner
-- pool only, no RLS, no app-role grant.
CREATE TABLE IF NOT EXISTS app_signin_codes (
    code_hash      text        PRIMARY KEY,
    user_id        text        NOT NULL,
    redirect_uri   text        NOT NULL,
    code_challenge text        NOT NULL,
    device_name    text        NOT NULL,
    expires_at     timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_signin_codes_expires ON app_signin_codes (expires_at);
