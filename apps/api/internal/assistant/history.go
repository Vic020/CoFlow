package assistant

import (
	"coflow/api/internal/identity"
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type HistoryQuery struct {
	Q, State, Cursor string
	Limit            int
}
type HistoryPage struct {
	Items      []Conversation `json:"items"`
	NextCursor string         `json:"next_cursor"`
}

func (s *Service) History(ctx context.Context, p identity.Principal, q HistoryQuery) (HistoryPage, error) {
	out := HistoryPage{Items: []Conversation{}}
	if q.Limit < 1 || q.Limit > 50 {
		q.Limit = 30
	}
	if len(q.Q) > 300 {
		return out, invalid("搜索内容过长")
	}
	if q.State == "" {
		q.State = "active"
	}
	if q.State != "active" && q.State != "archived" && q.State != "deleted" {
		return out, invalid("历史状态无效")
	}
	var cursor struct {
		At time.Time
		ID string
	}
	if q.Cursor != "" {
		raw, e := base64.RawURLEncoding.DecodeString(q.Cursor)
		if e != nil || json.Unmarshal(raw, &cursor) != nil || cursor.ID == "" || cursor.At.IsZero() {
			return out, invalid("分页标识无效")
		}
	}
	rows, e := s.Pool.Query(ctx, `SELECT id,title,config_id,updated_at,revision,archived_at,deleted_at,config_snapshot FROM assistant_conversations WHERE team_id=$1 AND owner_id=$2 AND (($3='active' AND archived_at IS NULL AND deleted_at IS NULL) OR ($3='archived' AND archived_at IS NOT NULL AND deleted_at IS NULL) OR ($3='deleted' AND deleted_at IS NOT NULL)) AND (title ILIKE '%'||$4||'%' OR document::text ILIKE '%'||$4||'%') AND ($5='' OR (updated_at,id)<($6::timestamptz,$5)) ORDER BY updated_at DESC,id DESC LIMIT $7`, p.TeamID, p.UserID, q.State, strings.TrimSpace(q.Q), cursor.ID, cursor.At, q.Limit+1)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var c Conversation
		if e = rows.Scan(&c.ID, &c.Title, &c.ConfigID, &c.UpdatedAt, &c.Revision, &c.ArchivedAt, &c.DeletedAt, &c.ConfigSnapshot); e != nil {
			return out, e
		}
		out.Items = append(out.Items, c)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		last := out.Items[len(out.Items)-1]
		b, _ := json.Marshal(struct {
			At time.Time
			ID string
		}{last.UpdatedAt, last.ID})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	return out, nil
}
func (s *Service) ChangeConversation(ctx context.Context, p identity.Principal, id, action, title string, rev int) error {
	var query string
	switch action {
	case "rename":
		title = strings.TrimSpace(title)
		if title == "" || len(title) > 180 {
			return invalid("请填写会话标题")
		}
		query = `title=$5`
	case "archive":
		query = `archived_at=now()`
	case "unarchive":
		query = `archived_at=NULL`
	case "delete":
		query = `deleted_at=now()`
	case "restore":
		query = `deleted_at=NULL`
	default:
		return invalid("历史操作无效")
	}
	sql := `UPDATE assistant_conversations SET ` + query + `,revision=revision+1,updated_at=now() WHERE id=$1 AND team_id=$2 AND owner_id=$3 AND revision=$4`
	args := []any{id, p.TeamID, p.UserID, rev}
	if action != "restore" && action != "delete" {
		sql += ` AND deleted_at IS NULL`
	}
	if action == "restore" {
		sql += ` AND deleted_at IS NOT NULL`
	}
	if action == "rename" {
		args = append(args, title)
		sql += ` AND deleted_at IS NULL`
	}
	tag, e := s.Pool.Exec(ctx, sql, args...)
	if e == nil && tag.RowsAffected() != 1 {
		return conflict()
	}
	return e
}

type Usage struct {
	Input  int  `json:"input"`
	Output int  `json:"output"`
	Total  int  `json:"total"`
	Known  bool `json:"known"`
}
type Trace struct {
	Name  string    `json:"name"`
	State string    `json:"state"`
	At    time.Time `json:"at"`
}
type usageContext struct{}

func usageCount(v any) int {
	n, _ := v.(float64)
	if n < 0 {
		return 0
	}
	return int(n)
}
