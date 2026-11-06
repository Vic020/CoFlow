ALTER TABLE assistant_conversations ADD COLUMN created_at timestamptz;
ALTER TABLE assistant_conversations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE assistant_conversations ADD COLUMN archived_at timestamptz;
ALTER TABLE assistant_conversations ADD COLUMN deleted_at timestamptz;
ALTER TABLE assistant_conversations ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE assistant_conversations ADD COLUMN config_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE assistant_actions ADD COLUMN decided_at timestamptz;
CREATE TABLE assistant_templates (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, revision integer NOT NULL DEFAULT 1,
 archived boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assistant_template_versions (
 template_id text NOT NULL REFERENCES assistant_templates(id) ON DELETE CASCADE,
 version integer NOT NULL, document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(template_id,version)
);
CREATE TABLE assistant_jobs (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, config_id text NOT NULL, config_revision integer NOT NULL, template_snapshot jsonb NOT NULL,
 context jsonb NOT NULL, parameters jsonb NOT NULL DEFAULT '{}', prompt text NOT NULL, locale text NOT NULL,
 timezone text NOT NULL, local_time text NOT NULL, weekdays integer[] NOT NULL,
 publish boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1, next_run_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assistant_runs (
 id text PRIMARY KEY, job_id text NOT NULL REFERENCES assistant_jobs(id) ON DELETE CASCADE,
 scheduled_at timestamptz NOT NULL, job_revision integer NOT NULL, state text NOT NULL DEFAULT 'queued',
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, lease_id text,
 retry_at timestamptz, conversation_id text, report_id text,
 fingerprint text, message text NOT NULL DEFAULT '', started_at timestamptz, finished_at timestamptz,
 UNIQUE(job_id,scheduled_at)
);
CREATE INDEX assistant_jobs_due ON assistant_jobs(next_run_at) WHERE enabled;
CREATE INDEX assistant_runs_pending ON assistant_runs(state,retry_at);
CREATE TABLE assistant_mcp_connections (
 id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 owner_id text REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, url text NOT NULL, secret bytea NOT NULL,
 tools jsonb NOT NULL DEFAULT '[]', approved_tools jsonb NOT NULL DEFAULT '[]',
 revision integer NOT NULL DEFAULT 1, verified_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
