-- Search/fetch credentials are independent from model configurations.
CREATE TABLE assistant_web_configs (
 id text PRIMARY KEY,
 team_id text REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('deepseek','tavily','exa','firecrawl')),
 secret bytea NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 is_default boolean NOT NULL DEFAULT false,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((team_id IS NULL) <> (owner_id IS NULL))
);
CREATE INDEX assistant_web_configs_scope ON assistant_web_configs(team_id,owner_id);
CREATE UNIQUE INDEX assistant_web_account_default ON assistant_web_configs(owner_id) WHERE owner_id IS NOT NULL AND is_default;
CREATE UNIQUE INDEX assistant_web_team_default ON assistant_web_configs(team_id) WHERE team_id IS NOT NULL AND is_default;
