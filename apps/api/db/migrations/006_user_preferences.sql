CREATE TABLE user_preferences (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'zh-CN')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
