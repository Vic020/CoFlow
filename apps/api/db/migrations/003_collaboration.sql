ALTER TABLE reports ADD COLUMN domains text[] NOT NULL DEFAULT '{}';
ALTER TABLE reports ADD COLUMN classification_input jsonb NOT NULL DEFAULT '{}';
ALTER TABLE reports ADD COLUMN classification_locked boolean NOT NULL DEFAULT false;
UPDATE reports SET domains=ARRAY[domain] WHERE domain<>'';

CREATE TABLE classifications (
 team_id text NOT NULL REFERENCES teams(id), kind text NOT NULL CHECK(kind IN ('project','domain')),
 id text NOT NULL, name text NOT NULL, normalized text NOT NULL, aliases text[] NOT NULL DEFAULT '{}',
 state text NOT NULL CHECK(state IN ('active','pending','archived','merged')),
 merged_into text NOT NULL DEFAULT '', created_by text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(team_id,kind,id), UNIQUE(team_id,kind,normalized)
);
CREATE TABLE report_history (
 id text PRIMARY KEY, team_id text NOT NULL, report_id text NOT NULL REFERENCES reports(id),
 actor_id text NOT NULL, action text NOT NULL, before_data jsonb NOT NULL, after_data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_history_lookup ON report_history(team_id,report_id,created_at);
CREATE TABLE collaboration_requests (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id), report_id text NOT NULL REFERENCES reports(id),
 author_id text NOT NULL, assignee_id text NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('open','in_progress','blocked','done','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_lookup ON collaboration_requests(team_id,report_id,created_at);
CREATE TABLE collaboration_updates (
 id text PRIMARY KEY, request_id text NOT NULL REFERENCES collaboration_requests(id), actor_id text NOT NULL,
 status text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id), user_id text NOT NULL,
 report_id text NOT NULL REFERENCES reports(id), request_id text NOT NULL DEFAULT '',
 kind text NOT NULL, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX notification_inbox ON notifications(team_id,user_id,created_at DESC);
CREATE TABLE report_reads (
 team_id text NOT NULL, user_id text NOT NULL, report_id text NOT NULL REFERENCES reports(id),
 seen_at timestamptz NOT NULL, PRIMARY KEY(team_id,user_id,report_id)
);
