-- name: ListReports :many
SELECT * FROM reports WHERE team_id = $1 ORDER BY created_at DESC, id DESC;

-- name: UpsertReport :one
INSERT INTO reports (id, team_id, author_id, source_id, title, body, project_id, domain, agent, model, status, links, mentions, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (team_id, author_id, source_id) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, project_id=EXCLUDED.project_id, domain=EXCLUDED.domain, agent=EXCLUDED.agent, model=EXCLUDED.model, status=EXCLUDED.status, links=EXCLUDED.links, mentions=EXCLUDED.mentions, updated_at=EXCLUDED.updated_at
RETURNING *;

-- name: GetReport :one
SELECT * FROM reports WHERE id=$1 AND team_id=$2;

-- name: ListComments :many
SELECT comments.* FROM comments JOIN reports ON reports.id=comments.report_id WHERE reports.team_id=$1 ORDER BY comments.created_at;

-- name: CreateComment :exec
WITH inserted AS (
 INSERT INTO comments(id, report_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING report_id, created_at
)
UPDATE reports SET updated_at=inserted.created_at FROM inserted WHERE reports.id=inserted.report_id;
