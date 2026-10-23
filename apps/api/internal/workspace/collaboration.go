package workspace

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

type Update struct {
	ID        string    `json:"id"`
	ActorID   string    `json:"actor_id"`
	Status    string    `json:"status"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}
type Collaboration struct {
	ID         string    `json:"id"`
	ReportID   string    `json:"report_id"`
	AuthorID   string    `json:"author_id"`
	AssigneeID string    `json:"assignee_id"`
	Title      string    `json:"title"`
	Body       string    `json:"body"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	Updates    []Update  `json:"updates"`
}
type Notification struct {
	ID        string     `json:"id"`
	ReportID  string     `json:"report_id"`
	RequestID string     `json:"request_id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	CreatedAt time.Time  `json:"created_at"`
	ReadAt    *time.Time `json:"read_at"`
}
type History struct {
	ID        string          `json:"id"`
	ActorID   string          `json:"actor_id"`
	Action    string          `json:"action"`
	Before    json.RawMessage `json:"before"`
	After     json.RawMessage `json:"after"`
	CreatedAt time.Time       `json:"created_at"`
}

func notify(ctx context.Context, tx pgx.Tx, p identity.Principal, ids []string, report, request, kind, title string) error {
	seen := map[string]bool{p.UserID: true}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		_, err := tx.Exec(ctx, `INSERT INTO notifications(id,team_id,user_id,report_id,request_id,kind,title)
   SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM memberships WHERE team_id=$2 AND user_id=$3)`, store.ID(), p.TeamID, id, report, request, kind, title)
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Collaborations(ctx context.Context, p identity.Principal) ([]Collaboration, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id,report_id,author_id,assignee_id,title,body,status,created_at,updated_at FROM collaboration_requests WHERE team_id=$1 ORDER BY updated_at DESC`, p.TeamID)
	if err != nil {
		return nil, err
	}
	out := []Collaboration{}
	for rows.Next() {
		var v Collaboration
		v.Updates = []Update{}
		if err = rows.Scan(&v.ID, &v.ReportID, &v.AuthorID, &v.AssigneeID, &v.Title, &v.Body, &v.Status, &v.CreatedAt, &v.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	updates, err := s.Pool.Query(ctx, `SELECT u.request_id,u.id,u.actor_id,u.status,u.body,u.created_at FROM collaboration_updates u JOIN collaboration_requests c ON c.id=u.request_id WHERE c.team_id=$1 ORDER BY u.created_at,u.id`, p.TeamID)
	if err != nil {
		return nil, err
	}
	defer updates.Close()
	index := map[string]int{}
	for i, v := range out {
		index[v.ID] = i
	}
	for updates.Next() {
		var id string
		var v Update
		if err = updates.Scan(&id, &v.ID, &v.ActorID, &v.Status, &v.Body, &v.CreatedAt); err != nil {
			return nil, err
		}
		i := index[id]
		out[i].Updates = append(out[i].Updates, v)
	}
	return out, updates.Err()
}
func (s *Service) CreateCollaboration(ctx context.Context, p identity.Principal, v Collaboration) (Collaboration, error) {
	v.Title = strings.TrimSpace(v.Title)
	v.Body = strings.TrimSpace(v.Body)
	if v.Title == "" || len(v.Title) > 600 || len(v.Body) > 12000 {
		return v, identity.Invalid("请填写协作标题，标题最多 600 字节，说明最多 12000 字节")
	}
	v.ID = store.ID()
	v.AuthorID = p.UserID
	v.Status = "open"
	v.CreatedAt = time.Now().UTC()
	v.UpdatedAt = v.CreatedAt
	v.Updates = []Update{}
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$2)`, p.TeamID, v.ReportID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return store.ErrNotFound
		}
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, p.TeamID, v.AssigneeID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return identity.Invalid("请选择当前团队成员作为负责人")
		}
		_, err := tx.Exec(ctx, `INSERT INTO collaboration_requests(id,team_id,report_id,author_id,assignee_id,title,body,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, v.ID, p.TeamID, v.ReportID, v.AuthorID, v.AssigneeID, v.Title, v.Body, v.Status, v.CreatedAt)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE reports SET updated_at=$3 WHERE team_id=$1 AND id=$2`, p.TeamID, v.ReportID, v.CreatedAt); err != nil {
			return err
		}
		return notify(ctx, tx, p, []string{v.AssigneeID}, v.ReportID, v.ID, "collaboration", "邀请你协作："+v.Title)
	})
	return v, err
}
func (s *Service) UpdateCollaboration(ctx context.Context, p identity.Principal, id, status, body string) error {
	body = strings.TrimSpace(body)
	if len(body) > 12000 {
		return identity.Invalid("进展说明过长")
	}
	switch status {
	case "open", "in_progress", "blocked", "done", "cancelled":
	default:
		return identity.Invalid("无效的协作状态")
	}
	return s.transaction(ctx, p, func(tx pgx.Tx) error {
		var v Collaboration
		err := tx.QueryRow(ctx, `SELECT report_id,author_id,assignee_id,title,status FROM collaboration_requests WHERE team_id=$1 AND id=$2 FOR UPDATE`, p.TeamID, id).Scan(&v.ReportID, &v.AuthorID, &v.AssigneeID, &v.Title, &v.Status)
		if err == pgx.ErrNoRows {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		if p.UserID != v.AuthorID && p.UserID != v.AssigneeID && !(p.Role == "admin" && p.Kind == "session") {
			return identity.Denied("只有发起人、负责人或网页管理员可以更新协作请求")
		}
		if status == v.Status && body == "" {
			return identity.Invalid("请补充进展或变更状态")
		}
		if _, err = tx.Exec(ctx, `UPDATE collaboration_requests SET status=$3,updated_at=now() WHERE team_id=$1 AND id=$2`, p.TeamID, id, status); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO collaboration_updates(id,request_id,actor_id,status,body) VALUES($1,$2,$3,$4,$5)`, store.ID(), id, p.UserID, status, body); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE reports SET updated_at=now() WHERE team_id=$1 AND id=$2`, p.TeamID, v.ReportID); err != nil {
			return err
		}
		return notify(ctx, tx, p, []string{v.AuthorID, v.AssigneeID}, v.ReportID, id, "collaboration", "协作有新进展："+v.Title)
	})
}
func (s *Service) Comment(ctx context.Context, p identity.Principal, c store.Comment, mentions []string) (store.Comment, error) {
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		var author, title string
		err := tx.QueryRow(ctx, `SELECT author_id,title FROM reports WHERE team_id=$1 AND id=$2`, p.TeamID, c.ReportID).Scan(&author, &title)
		if err == pgx.ErrNoRows {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		for _, id := range mentions {
			var ok bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, p.TeamID, id).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return identity.Invalid("关注成员不存在")
			}
		}
		if _, err = tx.Exec(ctx, `INSERT INTO comments(id,report_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5)`, c.ID, c.ReportID, p.UserID, c.Body, c.CreatedAt); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE reports SET updated_at=$3 WHERE team_id=$1 AND id=$2`, p.TeamID, c.ReportID, c.CreatedAt); err != nil {
			return err
		}
		ids := append([]string{author}, mentions...)
		rs, err := tx.Query(ctx, `SELECT DISTINCT author_id FROM comments WHERE report_id=$1`, c.ReportID)
		if err != nil {
			return err
		}
		for rs.Next() {
			var id string
			if err = rs.Scan(&id); err != nil {
				rs.Close()
				return err
			}
			ids = append(ids, id)
		}
		err = rs.Err()
		rs.Close()
		if err != nil {
			return err
		}
		return notify(ctx, tx, p, ids, c.ReportID, "", "comment", "新评论："+title)
	})
	return c, err
}
func (s *Service) Inbox(ctx context.Context, p identity.Principal) ([]Notification, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id,report_id,request_id,kind,title,created_at,read_at FROM notifications WHERE team_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 200`, p.TeamID, p.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var v Notification
		if err = rows.Scan(&v.ID, &v.ReportID, &v.RequestID, &v.Kind, &v.Title, &v.CreatedAt, &v.ReadAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Service) MarkRead(ctx context.Context, p identity.Principal, id string, seen time.Time) error {
	if seen.IsZero() {
		return identity.Invalid("缺少已展示的更新时间")
	}
	tag, err := s.Pool.Exec(ctx, `INSERT INTO report_reads(team_id,user_id,report_id,seen_at) SELECT $1,$2,id,LEAST($4,updated_at) FROM reports WHERE team_id=$1 AND id=$3
 ON CONFLICT(team_id,user_id,report_id) DO UPDATE SET seen_at=GREATEST(report_reads.seen_at,EXCLUDED.seen_at)`, p.TeamID, p.UserID, id, seen)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return store.ErrNotFound
	}
	return nil
}
func (s *Service) Reads(ctx context.Context, p identity.Principal) (map[string]time.Time, error) {
	rows, err := s.Pool.Query(ctx, `SELECT report_id,seen_at FROM report_reads WHERE team_id=$1 AND user_id=$2`, p.TeamID, p.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]time.Time{}
	for rows.Next() {
		var id string
		var seen time.Time
		if err = rows.Scan(&id, &seen); err != nil {
			return nil, err
		}
		out[id] = seen
	}
	return out, rows.Err()
}
func (s *Service) ReadNotification(ctx context.Context, p identity.Principal, id string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE team_id=$1 AND user_id=$2 AND ($3='' OR id=$3)`, p.TeamID, p.UserID, id)
	return err
}
func (s *Service) History(ctx context.Context, p identity.Principal, report string) ([]History, error) {
	var exists bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$2)`, p.TeamID, report).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, store.ErrNotFound
	}
	rows, err := s.Pool.Query(ctx, `SELECT id,actor_id,action,before_data,after_data,created_at FROM report_history WHERE team_id=$1 AND report_id=$2 ORDER BY created_at DESC LIMIT 100`, p.TeamID, report)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []History{}
	for rows.Next() {
		var v History
		if err = rows.Scan(&v.ID, &v.ActorID, &v.Action, &v.Before, &v.After, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
