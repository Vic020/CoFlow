-- Initial development schema. Authentication and team membership are added before production release.
CREATE TABLE IF NOT EXISTS reports (
 id text PRIMARY KEY,
 team_id text NOT NULL,
 author_id text NOT NULL,
 source_id text NOT NULL,
 title text NOT NULL,
 body text NOT NULL DEFAULT '',
 project_id text NOT NULL DEFAULT '',
 domain text NOT NULL DEFAULT '',
 agent text NOT NULL DEFAULT '',
 model text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'progress' CHECK(status IN ('progress','review','blocked','delivered','resolved')),
 links jsonb NOT NULL DEFAULT '[]',
 mentions jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (team_id, author_id, source_id)
);
CREATE INDEX IF NOT EXISTS reports_team_time ON reports(team_id, created_at DESC);
CREATE TABLE IF NOT EXISTS comments (
 id text PRIMARY KEY,
 report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
 author_id text NOT NULL,
 body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_report_time ON comments(report_id, created_at);
