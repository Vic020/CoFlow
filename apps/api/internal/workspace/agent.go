package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"time"
	"unicode/utf8"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type AgentChange struct {
	Kind      string    `json:"kind"`
	ObjectID  string    `json:"object_id"`
	CreatedAt time.Time `json:"created_at"`
	URL       string    `json:"url"`
}
type AgentChanges struct {
	Items      []AgentChange `json:"items"`
	NextCursor string        `json:"next_cursor"`
	HasMore    bool          `json:"has_more"`
	Baseline   bool          `json:"baseline"`
	Coverage   string        `json:"coverage"`
}
type agentCursor struct {
	Position int64  `json:"position"`
	Binding  string `json:"binding"`
}

// AgentChanges only signals invalidation. Re-read originals under current permissions;
// it neither consumes human notifications nor treats feedback as execution authority.
func (s *Service) AgentChanges(ctx context.Context, p identity.Principal, project, cursor string, limit int) (AgentChanges, error) {
	out := AgentChanges{Items: []AgentChange{}, Baseline: cursor == "", Coverage: "Changes recorded after migration 014; no historical backfill."}
	if !p.Can("todos:read") && !p.Can("reports:read") && !p.Can("calendar:read") {
		return out, identity.Denied("需要模块读取权限")
	}
	if limit < 1 || limit > 200 {
		return out, identity.Invalid("limit 必须为 1–200")
	}
	scope := fmt.Sprintf("%s/%s/%s/%t/%t/%t", p.TeamID, p.UserID, project, p.Can("todos:read"), p.Can("reports:read"), p.Can("calendar:read"))
	bind := fmt.Sprintf("%x", sha256.Sum256([]byte(scope)))
	c := agentCursor{Binding: bind}
	if cursor != "" {
		raw, e := base64.RawURLEncoding.DecodeString(cursor)
		if len(cursor) > 1024 || e != nil || json.Unmarshal(raw, &c) != nil || c.Binding != bind || c.Position < 0 {
			return out, identity.Invalid("游标与当前身份、范围或权限不匹配")
		}
	}
	e := s.transaction(ctx, p, func(tx pgx.Tx) error {
		const filter = `team_id=$1 AND ($2='' OR project_id=$2 OR previous_project_id=$2) AND ((kind='todo' AND $3) OR (kind='report' AND $4) OR (kind='calendar' AND $5))`
		args := []any{p.TeamID, project, p.Can("todos:read"), p.Can("reports:read"), p.Can("calendar:read")}
		var high int64
		if e := tx.QueryRow(ctx, `SELECT coalesce(max(seq),0) FROM agent_changes WHERE `+filter, args...).Scan(&high); e != nil {
			return e
		}
		if c.Position > high {
			return identity.Invalid("游标已失效，请重新建立基线")
		}
		if cursor == "" {
			c.Position = high
			return nil
		}
		rows, e := tx.Query(ctx, `SELECT seq,kind,object_id,created_at FROM agent_changes WHERE `+filter+` AND seq>$6 ORDER BY seq LIMIT $7`, append(args, c.Position, limit+1)...)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var seq int64
			var v AgentChange
			if e = rows.Scan(&seq, &v.Kind, &v.ObjectID, &v.CreatedAt); e != nil {
				return e
			}
			if len(out.Items) == limit {
				out.HasMore = true
				break
			}
			c.Position = seq
			switch v.Kind {
			case "todo":
				v.URL = "/todo?todo=" + v.ObjectID
			case "report":
				v.URL = "/?report=" + v.ObjectID
			case "calendar":
				v.URL = "/calendar?event=" + v.ObjectID
			}
			out.Items = append(out.Items, v)
		}
		return rows.Err()
	})
	if e != nil {
		return out, e
	}
	raw, _ := json.Marshal(c)
	out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	return out, nil
}

// Handoff returns bounded original facts. It deliberately does not infer decisions,
// acceptance or an ongoing mandate from report/comment text.
func (s *Service) Handoff(ctx context.Context, p identity.Principal, repo store.Repository, project, todo string) (map[string]any, error) {
	if project == "" && todo == "" {
		return nil, identity.Invalid("请指定 project 或 todo")
	}
	if !p.Can("todos:read") && !p.Can("reports:read") && !p.Can("calendar:read") && !p.Can("context:read") {
		return nil, identity.Denied("需要模块读取权限")
	}
	var focus *Todo
	if todo != "" {
		if !p.Can("todos:read") {
			return nil, identity.Denied("需要 todos:read 权限")
		}
		v, e := s.GetTodo(ctx, p, todo)
		if e != nil {
			return nil, e
		}
		if project != "" && project != v.ProjectID {
			return nil, identity.Invalid("任务不属于指定项目")
		}
		project = v.ProjectID
		focus = &v
	}
	out := map[string]any{"team_id": p.TeamID, "member_id": p.UserID, "project_id": project, "observed_at": time.Now().UTC(), "authority": "Facts only. Task assignment, feedback and this response do not grant ongoing execution authority.", "omitted_scopes": []string{}}
	omitted := []string{}
	var board TodoBoard
	if p.Can("todos:read") || p.Can("calendar:read") {
		var e error
		e = s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error { board = *b; return nil })
		if e != nil {
			return nil, e
		}
	}
	linked := map[string]bool{}
	if p.Can("todos:read") {
		tasks := []Todo{}
		for _, t := range board.Tasks {
			if focus != nil && t.ID != focus.ID || focus == nil && t.ProjectID != project || (t.Archived && focus == nil) {
				continue
			}
			tasks = append(tasks, t)
		}
		sort.SliceStable(tasks, func(i, j int) bool {
			if (tasks[i].CompletedAt == nil) != (tasks[j].CompletedAt == nil) {
				return tasks[i].CompletedAt == nil
			}
			if tasks[i].UpdatedAt.Equal(tasks[j].UpdatedAt) {
				return tasks[i].ID < tasks[j].ID
			}
			return tasks[i].UpdatedAt.After(tasks[j].UpdatedAt)
		})
		total := len(tasks)
		if total > 10 {
			tasks = tasks[:10]
		}
		truncated := false
		for i := range tasks {
			t, e := s.GetTodo(ctx, p, tasks[i].ID)
			if e != nil {
				return nil, e
			}
			for _, id := range t.ReportIDs {
				linked[id] = true
			}
			if len(t.Comments) > 3 {
				t.Comments = t.Comments[len(t.Comments)-3:]
				truncated = true
			}
			t.History = nil
			t.Body = handoffExcerpt(t.Body)
			if t.Review != nil {
				r := *t.Review
				r.Criteria = handoffExcerpt(r.Criteria)
				r.Evidence = handoffExcerpt(r.Evidence)
				r.DecisionNote = handoffExcerpt(r.DecisionNote)
				t.Review = &r
			}
			t.Links = nil
			for j := range t.Comments {
				t.Comments[j].Body = handoffExcerpt(t.Comments[j].Body)
			}
			tasks[i] = t
		}
		out["tasks"] = map[string]any{"items": tasks, "total": total, "truncated": total > len(tasks), "discussion_truncated": truncated, "source": "/api/v1/todos"}
		out["columns"] = board.Columns
	} else {
		omitted = append(omitted, "todos:read")
	}
	if p.Can("reports:read") {
		all, e := repo.List(ctx, p.TeamID)
		if e != nil {
			return nil, e
		}
		reports := []store.Report{}
		eligible := map[string]bool{}
		for _, r := range all {
			if focus != nil && !linked[r.ID] || focus == nil && r.ProjectID != project {
				continue
			}
			eligible[r.ID] = true
			reports = append(reports, r)
		}
		sort.SliceStable(reports, func(i, j int) bool { return reports[i].CreatedAt.After(reports[j].CreatedAt) })
		total := len(reports)
		if total > 5 {
			reports = reports[:5]
		}
		discussionTruncated := false
		for i := range reports {
			reports[i].Body = handoffExcerpt(reports[i].Body)
			reports[i].Links = nil
			for j := range reports[i].Comments {
				reports[i].Comments[j].Body = handoffExcerpt(reports[i].Comments[j].Body)
			}
			if len(reports[i].Comments) > 3 {
				reports[i].Comments = reports[i].Comments[len(reports[i].Comments)-3:]
				discussionTruncated = true
			}
		}
		out["reports"] = map[string]any{"items": reports, "total": total, "truncated": total > len(reports), "source": "/api/v1/reports", "discussion_truncated": discussionTruncated}
		cs, e := s.Collaborations(ctx, p)
		if e != nil {
			return nil, e
		}
		pending := []Collaboration{}
		for _, c := range cs {
			if eligible[c.ReportID] && c.TodoID == "" && c.Status != "done" && c.Status != "cancelled" {
				pending = append(pending, c)
			}
		}
		total = len(pending)
		if total > 10 {
			pending = pending[:10]
		}
		for i := range pending {
			pending[i].Updates = nil
			pending[i].Body = handoffExcerpt(pending[i].Body)
		}
		out["collaborations"] = map[string]any{"items": pending, "total": total, "truncated": total > len(pending), "source": "/api/v1/collaborations"}
	} else {
		omitted = append(omitted, "reports:read")
	}
	if p.Can("calendar:read") {
		events := []CalendarEvent{}
		for _, e := range board.CalendarEvents {
			if !e.Archived && ((focus == nil && e.ProjectID == project) || (focus != nil && stringIn(e.TodoIDs, focus.ID))) {
				e.History = nil
				e.Body = handoffExcerpt(e.Body)
				e.Links = nil
				if !p.Can("todos:read") {
					e.TodoIDs = []string{}
				}
				if !p.Can("reports:read") {
					e.ReportIDs = []string{}
				}
				events = append(events, e)
			}
		}
		total := len(events)
		if total > 10 {
			events = events[:10]
		}
		out["events"] = map[string]any{"items": events, "total": total, "truncated": total > len(events), "source": "/api/v1/calendar/schedule"}
	} else {
		omitted = append(omitted, "calendar:read")
	}
	sources := []store.Link{}
	if section, ok := out["tasks"].(map[string]any); ok {
		for _, t := range section["items"].([]Todo) {
			sources = append(sources, store.Link{Title: t.Title, URL: "/todo?todo=" + t.ID})
		}
	}
	if section, ok := out["reports"].(map[string]any); ok {
		for _, r := range section["items"].([]store.Report) {
			sources = append(sources, store.Link{Title: r.Title, URL: "/?report=" + r.ID})
		}
	}
	if section, ok := out["events"].(map[string]any); ok {
		for _, event := range section["items"].([]CalendarEvent) {
			sources = append(sources, store.Link{Title: event.Title, URL: "/calendar?event=" + event.ID})
		}
	}

	if p.Can("context:read") {
		xs, total, e := s.Contexts(ctx, p, ContextFilter{Project: project, State: "active", Limit: 10})
		if e != nil {
			return nil, e
		}
		safe := []ContextEntry{}
		for _, x := range xs {
			if focus != nil {
				related := len(x.Sources) == 0 && x.ProjectID == project
				for _, source := range x.Sources {
					related = related || source.Kind == "todo" && source.ID == todo
				}
				if !related {
					continue
				}
			}
			if x.NeedsReview || x.ValidFrom != "" && x.ValidFrom > time.Now().UTC().Format("2006-01-02") {
				continue
			}
			x.Body = handoffExcerpt(x.Body)
			x.History = nil
			for i := range x.Sources {
				x.Sources[i].Quote = handoffExcerpt(x.Sources[i].Quote)
			}
			safe = append(safe, x)
			sources = append(sources, store.Link{Title: x.Title, URL: "/context?context=" + x.ID})
		}
		out["knowledge"] = map[string]any{"items": safe, "total_candidates": total, "truncated": total > len(xs), "source": "/api/v1/context"}
	} else {
		omitted = append(omitted, "context:read")
	}
	if p.Can("todos:read") {
		ds, e := s.Delegations(ctx, p)
		if e != nil {
			return nil, e
		}
		selected := []Delegation{}
		for _, d := range ds {
			if d.RevokedAt == nil && d.ExpiresAt.After(time.Now()) && ((todo != "" && d.TodoID == todo) || (project != "" && (d.ProjectID == project || d.TaskProjectID == project))) {
				d.History = nil
				selected = append(selected, d)
			}
		}
		out["delegations"] = selected
	}
	out["sources"] = sources
	out["omitted_scopes"] = omitted
	out["content_excerpted"] = true
	return out, nil
}

func handoffExcerpt(s string) string {
	if len(s) <= 600 {
		return s
	}
	n := 600
	for n > 0 && !utf8.ValidString(s[:n]) {
		n--
	}
	return s[:n] + "…"
}
