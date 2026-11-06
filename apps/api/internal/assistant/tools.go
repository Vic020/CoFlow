package assistant

import (
	"context"
	"encoding/json"
	"net/url"
	"sort"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
)

type Link struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}
type Action struct {
	Available *bool           `json:"available,omitempty"`
	DecidedAt *time.Time      `json:"decided_at,omitempty"`
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Title     string          `json:"title"`
	Payload   json.RawMessage `json:"payload"`
	State     string          `json:"state"`
	Result    any             `json:"result,omitempty"`
}
type ToolArgs struct {
	Domain           string              `json:"domain"`
	MemberID         string              `json:"member_id"`
	ReportID         string              `json:"report_id"`
	Revision         string              `json:"revision"`
	ProjectName      string              `json:"project_name,omitempty"`
	ColumnName       string              `json:"column_name,omitempty"`
	OriginalSchedule *workspace.Schedule `json:"original_schedule,omitempty"`
	ProjectID        string              `json:"project_id"`
	Q                string              `json:"q"`
	Offset           int                 `json:"offset"`
	From             string              `json:"from"`
	To               string              `json:"to"`
	Timezone         string              `json:"timezone"`
	Cursor           string              `json:"cursor"`
	Title            string              `json:"title"`
	Body             string              `json:"body"`
	ColumnID         string              `json:"column_id"`
	TodoID           string              `json:"todo_id"`
	ExpectedRevision int                 `json:"expected_revision"`
	Schedule         *workspace.Schedule `json:"schedule"`
	TodoIDs          []string            `json:"todo_ids"`
}

func (s *Service) tool(ctx context.Context, p identity.Principal, name string, a ToolArgs) (any, *Action, []Link, error) {
	links := []Link{}
	switch name {
	case "read_workspace":
		m, e := s.Identity.Metadata(ctx, p)
		if e != nil {
			return nil, nil, nil, e
		}
		catalog, e := s.Workspace.Catalog(ctx, p)
		if e != nil {
			return nil, nil, nil, e
		}
		board, e := s.Workspace.TodoBoard(ctx, p)
		return map[string]any{"metadata": m, "catalog": catalog, "columns": board.Columns}, nil, nil, e
	case "find_todos":
		xs, e := s.Workspace.Todos(ctx, p)
		if e != nil {
			return nil, nil, nil, e
		}
		out := []workspace.Todo{}
		for _, x := range xs {
			if !x.Archived && (a.Domain == "" || has(x.Domains, a.Domain)) && (a.MemberID == "" || x.AssigneeID == a.MemberID) && (a.ProjectID == "" || x.ProjectID == a.ProjectID) && (a.Q == "" || strings.Contains(strings.ToLower(x.Title+" "+x.Body), strings.ToLower(a.Q))) {
				x.History = nil
				x.Comments = nil
				out = append(out, x)
			}
		}
		start, end := window(a.Offset, len(out))
		for _, x := range out[start:end] {
			links = append(links, Link{x.Title, "/todo?todo=" + url.QueryEscape(x.ID)})
		}
		return map[string]any{"items": out[start:end], "total": len(out), "next_offset": end, "has_more": end < len(out)}, nil, links, nil
	case "find_reports":
		xs, e := s.Repo.List(ctx, p.TeamID)
		if e != nil {
			return nil, nil, nil, e
		}
		out := []store.Report{}
		for _, x := range xs {
			if (a.Domain == "" || x.Domain == a.Domain || has(x.Domains, a.Domain)) && (a.MemberID == "" || x.AuthorID == a.MemberID) && (a.ProjectID == "" || x.ProjectID == a.ProjectID) && (a.Q == "" || strings.Contains(strings.ToLower(x.Title+" "+x.Body), strings.ToLower(a.Q))) {
				x.Comments = nil
				out = append(out, x)
			}
		}
		sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
		start, end := window(a.Offset, len(out))
		for _, x := range out[start:end] {
			links = append(links, Link{x.Title, "/?report=" + url.QueryEscape(x.ID)})
		}
		return map[string]any{"items": out[start:end], "total": len(out), "next_offset": end, "has_more": end < len(out)}, nil, links, nil
	case "read_calendar":
		q, e := workspace.ParseCalendarQuery(url.Values{"from": {a.From}, "to": {a.To}, "timezone": {a.Timezone}, "project": {a.ProjectID}, "cursor": {a.Cursor}, "revision": {a.Revision}, "domain": {a.Domain}, "member": {a.MemberID}, "limit": {"30"}})
		if e != nil {
			return nil, nil, nil, e
		}
		v, e := s.Workspace.CalendarSchedule(ctx, p, q)
		links = append(links, Link{"Calendar", "/calendar?mode=schedule&date=" + url.QueryEscape(a.From)})
		return v, nil, links, e
	case "read_todo":
		t, e := s.Workspace.GetTodo(ctx, p, a.TodoID)
		if e != nil {
			return nil, nil, nil, e
		}
		truncated := len(t.Comments) > 10 || len(t.History) > 10
		if len(t.Comments) > 10 {
			t.Comments = t.Comments[len(t.Comments)-10:]
		}
		if len(t.History) > 10 {
			t.History = t.History[len(t.History)-10:]
		}
		return map[string]any{"task": t, "discussion_truncated": truncated}, nil, []Link{{t.Title, "/todo?todo=" + url.QueryEscape(t.ID)}}, nil
	case "read_report":
		r, e := s.Repo.Get(ctx, p.TeamID, a.ReportID)
		if e != nil {
			return nil, nil, nil, e
		}
		r.TodoIDs, e = s.Workspace.ReportTodoIDs(ctx, p, r.ID)
		if e != nil {
			return nil, nil, nil, e
		}
		truncated := len(r.Comments) > 10
		if truncated {
			r.Comments = r.Comments[len(r.Comments)-10:]
		}
		return map[string]any{"report": r, "discussion_truncated": truncated}, nil, []Link{{r.Title, "/?report=" + url.QueryEscape(r.ID)}}, nil
	case "propose_todo", "propose_schedule", "propose_report":
		if e := s.validateAction(ctx, p, name, a); e != nil {
			return nil, nil, nil, e
		}
		title := a.Title
		if name == "propose_schedule" {
			t, e := s.Workspace.GetTodo(ctx, p, a.TodoID)
			if e != nil {
				return nil, nil, nil, e
			}
			title = t.Title
		}

		a.ProjectName = ""
		a.ColumnName = ""
		a.OriginalSchedule = nil
		if name == "propose_schedule" {
			t, e := s.Workspace.GetTodo(ctx, p, a.TodoID)
			if e != nil {
				return nil, nil, nil, e
			}
			a.ProjectID = t.ProjectID
			a.OriginalSchedule = t.Schedule
		}
		if a.ProjectID != "" {
			catalog, e := s.Workspace.Catalog(ctx, p)
			if e != nil {
				return nil, nil, nil, e
			}
			for _, c := range catalog {
				if c.ID == a.ProjectID {
					a.ProjectName = c.Name
				}
			}
		}
		if name == "propose_todo" {
			board, e := s.Workspace.TodoBoard(ctx, p)
			if e != nil {
				return nil, nil, nil, e
			}
			for _, c := range board.Columns {
				if c.ID == a.ColumnID {
					a.ColumnName = c.Name
				}
			}
		}
		b, _ := json.Marshal(a)
		action := &Action{ID: store.ID(), Kind: name, Title: title, Payload: b, State: "pending"}
		return map[string]any{"action_id": action.ID, "state": "awaiting_user_confirmation", "not_executed": true}, action, nil, nil
	default:
		return nil, nil, nil, invalid("助手不支持此操作")
	}
}
func window(offset, n int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if offset > n {
		offset = n
	}
	end := offset + 20
	if end > n {
		end = n
	}
	return offset, end
}
func (s *Service) validateAction(ctx context.Context, p identity.Principal, name string, a ToolArgs) error {
	if name == "propose_schedule" {
		if a.Schedule == nil {
			return invalid("请选择排期")
		}
		if e := a.Schedule.Validate(false); e != nil {
			return e
		}
		t, e := s.Workspace.GetTodo(ctx, p, a.TodoID)
		if e != nil {
			return e
		}
		if t.Archived || t.Revision != a.ExpectedRevision {
			return conflict()
		}
		if !admin(p) && t.CreatorID != p.UserID && t.AssigneeID != p.UserID {
			return identity.Denied("无权修改此任务")
		}
		return nil
	}
	if strings.TrimSpace(a.Title) == "" || len(a.Title) > 300 || len(a.Body) > 12000 {
		return invalid("草稿标题或内容无效")
	}
	if a.ProjectID != "" {
		catalog, e := s.Workspace.Catalog(ctx, p)
		if e != nil {
			return e
		}
		found := false
		for _, c := range catalog {
			if c.ID == a.ProjectID && c.Kind == "project" && (c.State == "active" || c.State == "pending") {
				found = true
			}
		}
		if !found {
			return invalid("项目不可用")
		}
	}
	if name == "propose_todo" {
		b, e := s.Workspace.TodoBoard(ctx, p)
		if e != nil {
			return e
		}
		for _, c := range b.Columns {
			if c.ID == a.ColumnID && !c.Archived && !c.Done {
				return nil
			}
		}
		return invalid("请选择未完成的任务列")
	}
	if len(a.TodoIDs) > 20 {
		return invalid("关联数量过多")
	}
	for _, id := range a.TodoIDs {
		if _, e := s.Workspace.GetTodo(ctx, p, id); e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) execute(ctx context.Context, p identity.Principal, id, kind string, a ToolArgs) (any, error) {
	if kind != "propose_schedule" {
		if e := s.validateAction(ctx, p, kind, a); e != nil {
			return nil, e
		}
	}
	switch kind {
	case "propose_todo":
		return s.Workspace.ChangeTodo(ctx, p, "", workspace.TodoInput{Todo: workspace.Todo{Title: a.Title, Body: a.Body, ColumnID: a.ColumnID, ProjectID: a.ProjectID, SourceID: "assistant:" + id, Agent: "CoFlow Assistant"}, OperationID: "assistant:" + id})
	case "propose_schedule":
		// Let the existing service apply object ownership, revision, schedule validation and history atomically.
		var in workspace.TodoInput
		b, _ := json.Marshal(map[string]any{"action": "edit", "schedule": a.Schedule, "expected_revision": a.ExpectedRevision, "operation_id": "assistant:" + id, "agent": "CoFlow Assistant"})
		if e := json.Unmarshal(b, &in); e != nil {
			return nil, e
		}
		return s.Workspace.ChangeTodo(ctx, p, a.TodoID, in)
	case "propose_report":
		if !p.Can("reports:write") {
			return nil, identity.Denied("需要 reports:write 权限")
		}
		now := time.Now().UTC()
		r := store.Report{ID: store.ID(), SourceID: "assistant:" + id, TeamID: p.TeamID, AuthorID: p.UserID, Title: a.Title, Body: a.Body, ProjectID: a.ProjectID, TodoIDs: a.TodoIDs, Status: "progress", Agent: "CoFlow Assistant", CreatedAt: now, UpdatedAt: now}
		return s.Workspace.SaveReport(ctx, p, r)
	}
	return nil, invalid("助手不支持此操作")
}

func has(xs []string, value string) bool {
	for _, v := range xs {
		if v == value {
			return true
		}
	}
	return false
}
