-- A person's profile (MH-343): what they are called, their picture, and the language and timezone
-- they want. Not tenant data, so it lives on the owner pool with no RLS and no grant to the app role.
--
-- Its own table rather than columns on `users`: the auth plugin owns `users` and its ORM reads the
-- row whole (the same reason platform_users exists). A missing row means an empty profile.
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id    text        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL DEFAULT '' CHECK (length(name) <= 120),
    -- A small image stored inline as a data: URL, as project avatars are, so a list renders it
    -- with no extra request. The API re-encodes every upload to a 256px JPEG, well inside this.
    avatar     text        CHECK (avatar IS NULL OR (avatar ~ '^data:image/(png|jpeg|webp);base64,' AND length(avatar) <= 300000)),
    -- NULL: follow the browser or the device.
    locale     text        CHECK (locale IS NULL OR locale IN ('en', 'ar')),
    -- An IANA name, checked by the API against the tz database it ships with. NULL: the device's.
    timezone   text        CHECK (timezone IS NULL OR length(timezone) <= 64),
    updated_at timestamptz NOT NULL DEFAULT now()
);
