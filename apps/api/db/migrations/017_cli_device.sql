CREATE TABLE cli_device_requests (
 device_hash text PRIMARY KEY,
 user_code_hash text NOT NULL UNIQUE,
 name text NOT NULL,
 scopes text[] NOT NULL,
 days integer NOT NULL CHECK (days BETWEEN 1 AND 30),
 expires_at timestamptz NOT NULL,
 next_poll_at timestamptz NOT NULL DEFAULT now(),
 poll_interval integer NOT NULL DEFAULT 5,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','denied')),
 user_id text,
 team_id text,
 FOREIGN KEY (team_id,user_id) REFERENCES memberships(team_id,user_id) ON DELETE CASCADE
);
CREATE INDEX cli_device_requests_expiry ON cli_device_requests(expires_at);
