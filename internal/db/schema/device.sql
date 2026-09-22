-- A phone that can receive native push (MH-352): one row per app install, keyed by the push token
-- FCM hands that install. User-level, not tenant data, so it lives on the owner pool with no RLS
-- and no grant to the app role, like push_subscriptions (the Web Push half, platform.sql).
CREATE TABLE IF NOT EXISTS devices (
    id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id      text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     text        NOT NULL CHECK (platform IN ('ios', 'android')),
    -- Which app: the team app or the client (customer) app. They are separate installs with
    -- separate tokens, and a notification for staff must not reach a customer's phone.
    app          text        NOT NULL CHECK (app IN ('team', 'client')),
    -- UNIQUE: a token names one install. When someone else signs in on the same phone, the row
    -- moves to them rather than the phone receiving both people's notifications.
    push_token   text        NOT NULL UNIQUE CHECK (length(push_token) BETWEEN 1 AND 4096),
    app_version  text        NOT NULL DEFAULT '',
    locale       text        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id);
