package workspace

import (
	"context"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
)

type ActivityFollow struct {
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
	Title    string `json:"title,omitempty"`
}

type ActivityItem struct {
	ID              string    `json:"id"`
	Kind            string    `json:"kind"`
	Title           string    `json:"title"`
	ActorID         string    `json:"actor_id"`
	ProjectID       string    `json:"project_id"`
	ReportID        string    `json:"report_id,omitempty"`
	TodoID          string    `json:"todo_id,omitempty"`
	CommentID       string    `json:"comment_id,omitempty"`
	CalendarEventID string    `json:"calendar_event_id,omitempty"`
	ContextID       string    `json:"context_id,omitempty"`
	Starred         bool      `json:"starred"`
	CreatedAt       time.Time `json:"created_at"`
}

func (s *Service) ActivityFollows(ctx context.Context, p identity.Principal) ([]ActivityFollow, error) {
	rows, err := s.Pool.Query(ctx, `SELECT f.kind,f.target_id,COALESCE(r.title,'')
		FROM activity_follows f
		LEFT JOIN reports r ON f.kind='report' AND r.team_id=f.team_id AND r.id=f.target_id AND r.deleted_at IS NULL
		WHERE f.team_id=$1 AND f.user_id=$2
		AND ((kind='project' AND EXISTS(SELECT 1 FROM projects WHERE team_id=$1 AND id=f.target_id))
		  OR (kind='member' AND EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=f.target_id))
		  OR r.id IS NOT NULL)
		ORDER BY kind,target_id`, p.TeamID, p.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ActivityFollow{}
	for rows.Next() {
		var item ActivityFollow
		if err := rows.Scan(&item.Kind, &item.TargetID, &item.Title); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) SetActivityFollow(ctx context.Context, p identity.Principal, kind, id string, following bool) error {
	if kind != "project" && kind != "member" && kind != "report" || id == "" || len(id) > 128 || kind == "member" && id == p.UserID {
		return identity.Invalid("请选择要星标的项目、成员或简报")
	}
	if !following {
		_, err := s.Pool.Exec(ctx, `DELETE FROM activity_follows WHERE team_id=$1 AND user_id=$2 AND kind=$3 AND target_id=$4`, p.TeamID, p.UserID, kind, id)
		return err
	}
	tag, err := s.Pool.Exec(ctx, `INSERT INTO activity_follows(team_id,user_id,kind,target_id)
		SELECT $1,$2,$3,$4 WHERE ($3='project' AND EXISTS(SELECT 1 FROM projects WHERE team_id=$1 AND id=$4))
			OR ($3='member' AND EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$4))
			OR ($3='report' AND EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$4 AND deleted_at IS NULL))
		ON CONFLICT (team_id,user_id,kind,target_id) DO UPDATE SET target_id=EXCLUDED.target_id`, p.TeamID, p.UserID, kind, id)
	if err == nil && tag.RowsAffected() == 0 {
		return store.ErrNotFound
	}
	return err
}

func (s *Service) RecentActivity(ctx context.Context, p identity.Principal, view string) ([]ActivityItem, error) {
	rows, err := s.Pool.Query(ctx, `
		WITH board AS (SELECT document FROM todo_boards WHERE team_id=$1),
		tasks AS (
			SELECT task->>'id' AS id, task->>'project_id' AS project_id
			FROM board CROSS JOIN LATERAL jsonb_array_elements(NULLIF(document->'tasks','null')) task
		),
		events AS (
			SELECT n.id, CASE WHEN COALESCE(c.parent_id,'')<>'' THEN 'comment-reply' ELSE substr(n.kind,5) END AS kind, n.title, n.actor_id,
				COALESCE(t.project_id,e.document->>'project_id',r.project_id,'') AS project_id,
				COALESCE(r.id,'') AS report_id, COALESCE(t.id,'') AS todo_id, n.comment_id,
				COALESCE(e.id,'') AS calendar_event_id, '' AS context_id,n.created_at
			FROM notifications n
			LEFT JOIN tasks t ON t.id=n.todo_id
			LEFT JOIN reports r ON r.team_id=n.team_id AND r.id=n.report_id AND r.deleted_at IS NULL
			LEFT JOIN calendar_events e ON e.team_id=n.team_id AND e.id=n.calendar_event_id
			LEFT JOIN comments c ON c.id=n.comment_id AND c.report_id=r.id AND c.deleted_at IS NULL
			WHERE n.team_id=$1 AND left(n.kind,4)='own-' AND n.created_at >= now()-interval '30 days'
				AND (t.id IS NOT NULL OR r.id IS NOT NULL OR e.id IS NOT NULL) AND (n.comment_id='' OR c.id IS NOT NULL)
			UNION ALL
			SELECT 'context:'||(entry->>'id')||':'||(rev->>'revision'), 'context', entry->>'title',
				rev->>'actor_id', COALESCE(rev->>'project_id',''), '', '', '', '', entry->>'id', (rev->>'at')::timestamptz
			FROM board CROSS JOIN LATERAL jsonb_array_elements(NULLIF(document->'contexts','null')) entry
				CROSS JOIN LATERAL jsonb_array_elements(NULLIF(entry->'history','null')) rev
			WHERE (entry->>'creator_id'=$2 OR (entry->>'visibility'='team' AND rev->>'visibility'='team'))
				AND entry->>'state'<>'archived' AND (rev->>'at')::timestamptz >= now()-interval '30 days'
		),
		scoped AS (
			SELECT *, EXISTS(SELECT 1 FROM activity_follows f WHERE f.team_id=$1 AND f.user_id=$2
				AND ((f.kind='project' AND f.target_id=events.project_id) OR (f.kind='member' AND f.target_id=events.actor_id)
					OR (f.kind='report' AND f.target_id=events.report_id))) AS starred
			FROM events
			UNION ALL
			SELECT 'starred-report:'||r.id,'starred-report',r.title,r.author_id,r.project_id,r.id,'','','','',f.followed_at,true
			FROM activity_follows f JOIN reports r ON r.team_id=f.team_id AND r.id=f.target_id AND r.deleted_at IS NULL
			WHERE $3='starred' AND f.team_id=$1 AND f.user_id=$2 AND f.kind='report'
				AND NOT EXISTS (SELECT 1 FROM events WHERE report_id=r.id)
		)
		SELECT id,kind,title,actor_id,project_id,report_id,todo_id,comment_id,calendar_event_id,context_id,starred,created_at
		FROM scoped WHERE ($3<>'starred' OR starred) AND ($3<>'mine' OR actor_id=$2)
		ORDER BY created_at DESC,id DESC LIMIT 200`, p.TeamID, p.UserID, view)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ActivityItem{}
	for rows.Next() {
		var item ActivityItem
		if err := rows.Scan(&item.ID, &item.Kind, &item.Title, &item.ActorID, &item.ProjectID, &item.ReportID, &item.TodoID, &item.CommentID, &item.CalendarEventID, &item.ContextID, &item.Starred, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
