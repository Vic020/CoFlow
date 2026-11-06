-- Assistant credentials never enter conversation documents or browser storage.
CREATE TABLE assistant_configs (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 provider text NOT NULL,
 protocol text NOT NULL,
 base_url text NOT NULL,
 model text NOT NULL,
 secret bytea NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 is_default boolean NOT NULL DEFAULT false,
 verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_configs_scope ON assistant_configs(team_id,owner_id);
CREATE TABLE assistant_conversations (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 config_id text NOT NULL,
 title text NOT NULL,
 document jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_owner ON assistant_conversations(team_id,owner_id,updated_at DESC);
CREATE TABLE assistant_actions (
 id text PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL,
 title text NOT NULL,
 payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','failed','cancelled')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assistant_preferences (
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 config_id text NOT NULL,
 PRIMARY KEY(team_id,owner_id)
);
