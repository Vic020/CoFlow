CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, color text NOT NULL DEFAULT 'mint', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE teams (
 id text PRIMARY KEY, name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Shanghai', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 team_id text NOT NULL REFERENCES teams(id), user_id text NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('admin','member')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(team_id,user_id)
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), team_id text NOT NULL REFERENCES teams(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE invites (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id), email text NOT NULL, token_hash text NOT NULL UNIQUE,
 created_by text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_team ON invites(team_id,created_at DESC);
CREATE TABLE agent_tokens (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id), user_id text NOT NULL REFERENCES users(id),
 name text NOT NULL, token_hash text NOT NULL UNIQUE, prefix text NOT NULL, scopes text[] NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_tokens_owner ON agent_tokens(team_id,user_id,created_at DESC);
CREATE TABLE projects (
 id text NOT NULL, team_id text NOT NULL REFERENCES teams(id), name text NOT NULL,
 domains text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT '进行中', PRIMARY KEY(team_id,id)
);
CREATE TABLE domains (
 team_id text NOT NULL REFERENCES teams(id), name text NOT NULL, position integer NOT NULL DEFAULT 0, PRIMARY KEY(team_id,name)
);
