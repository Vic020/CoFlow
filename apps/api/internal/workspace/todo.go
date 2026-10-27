package workspace

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type TodoColumn struct {
	TaskCount int    `json:"task_count"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Done      bool   `json:"done"`
	Archived  bool   `json:"archived"`
	Revision  int    `json:"revision"`
}
type TodoEvent struct {
	ActorKind string          `json:"actor_kind"`
	ID        string          `json:"id"`
	ActorID   string          `json:"actor_id"`
	Agent     string          `json:"agent"`
	Model     string          `json:"model"`
	Action    string          `json:"action"`
	CreatedAt time.Time       `json:"created_at"`
	Before    json.RawMessage `json:"before"`
	After     json.RawMessage `json:"after"`
}
type TodoComment struct {
	ID        string    `json:"id"`
	AuthorID  string    `json:"author_id"`
	Body      string    `json:"body"`
	Mentions  []string  `json:"mentions"`
	CreatedAt time.Time `json:"created_at"`
	Deleted   bool      `json:"deleted"`
}
type Todo struct {
	UnavailableReports int           `json:"unavailable_reports"`
	ID                 string        `json:"id"`
	SourceID           string        `json:"source_id"`
	CreatorID          string        `json:"creator_id"`
	Title              string        `json:"title"`
	Body               string        `json:"body"`
	ColumnID           string        `json:"column_id"`
	PreviousColumnID   string        `json:"previous_column_id"`
	AssigneeID         string        `json:"assignee_id"`
	ProjectID          string        `json:"project_id"`
	Domains            []string      `json:"domains"`
	Priority           string        `json:"priority"`
	DueDate            string        `json:"due_date"`
	Links              []store.Link  `json:"links"`
	ReportIDs          []string      `json:"report_ids"`
	CollaborationID    string        `json:"collaboration_id"`
	Agent              string        `json:"agent"`
	Model              string        `json:"model"`
	Revision           int           `json:"revision"`
	Archived           bool          `json:"archived"`
	Position           int           `json:"position"`
	CompletedAt        *time.Time    `json:"completed_at"`
	CreatedAt          time.Time     `json:"created_at"`
	UpdatedAt          time.Time     `json:"updated_at"`
	Comments           []TodoComment `json:"comments"`
	History            []TodoEvent   `json:"history"`
}
type TodoReplay struct {
	Hash   string          `json:"hash"`
	Result json.RawMessage `json:"result"`
}
type TodoBoard struct {
	History       []TodoEvent           `json:"history"`
	Revision      int                   `json:"revision"`
	DefaultDoneID string                `json:"default_done_id"`
	Columns       []TodoColumn          `json:"columns"`
	Tasks         []Todo                `json:"tasks"`
	Operations    map[string]TodoReplay `json:"operations,omitempty"`
}
type TodoMemory struct {
	mu    sync.Mutex
	board *TodoBoard
}
type TodoInput struct {
	Fields map[string]json.RawMessage `json:"-"`
	Todo
	ExpectedRevision int      `json:"expected_revision"`
	BoardRevision    int      `json:"board_revision"`
	OperationID      string   `json:"operation_id"`
	Action           string   `json:"action"`
	BeforeID         string   `json:"before_id"`
	AfterID          string   `json:"after_id"`
	CommentID        string   `json:"comment_id"`
	Mentions         []string `json:"mentions"`
}
type ColumnInput struct {
	TodoColumn
	ExpectedRevision int      `json:"expected_revision"`
	BoardRevision    int      `json:"board_revision"`
	OperationID      string   `json:"operation_id"`
	TargetID         string   `json:"target_id"`
	IDs              []string `json:"ids"`
	Action           string   `json:"action"`
}

func newTodoBoard() *TodoBoard {
	return &TodoBoard{Revision: 1, DefaultDoneID: "done", Columns: []TodoColumn{{0, "backlog", "待办", false, false, 1}, {0, "doing", "进行中", false, false, 1}, {0, "review", "待确认", false, false, 1}, {0, "done", "已完成", true, false, 1}}, Tasks: []Todo{}, Operations: map[string]TodoReplay{}}
}
func todoConflict() error {
	return &identity.Error{Status: 409, Message: "任务或看板已更新，请刷新后重试"}
}
func todoAdmin(p identity.Principal) bool {
	return p.Kind == "session" && p.Role == "admin" || p.Kind == "demo"
}
func todoWrite(p identity.Principal, t Todo) bool {
	return todoAdmin(p) || t.CreatorID == p.UserID || t.AssigneeID == p.UserID
}
func (b *TodoBoard) column(id string) *TodoColumn {
	for i := range b.Columns {
		if b.Columns[i].ID == id {
			return &b.Columns[i]
		}
	}
	return nil
}
func (b *TodoBoard) task(id string) *Todo {
	for i := range b.Tasks {
		if b.Tasks[i].ID == id {
			return &b.Tasks[i]
		}
	}
	return nil
}
func (s *Service) todoTransaction(ctx context.Context, p identity.Principal, fn func(pgx.Tx, *TodoBoard) error) error {
	if s.TodoDemo != nil {
		s.TodoDemo.mu.Lock()
		defer s.TodoDemo.mu.Unlock()
		if s.TodoDemo.board == nil {
			s.TodoDemo.board = newTodoBoard()
		}
		raw, _ := json.Marshal(s.TodoDemo.board)
		var b TodoBoard
		_ = json.Unmarshal(raw, &b)
		if err := fn(nil, &b); err != nil {
			return err
		}
		s.TodoDemo.board = &b
		return nil
	}
	return s.transaction(ctx, p, func(tx pgx.Tx) error {
		b, err := loadTodoBoard(ctx, tx, p.TeamID)
		if err != nil {
			return err
		}
		before, _ := json.Marshal(b)
		if err = fn(tx, b); err != nil {
			return err
		}
		after, _ := json.Marshal(b)
		if bytes.Equal(before, after) {
			return nil
		}
		return saveTodoBoard(ctx, tx, p.TeamID, b)
	})
}
func loadTodoBoard(ctx context.Context, tx pgx.Tx, team string) (*TodoBoard, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT document FROM todo_boards WHERE team_id=$1`, team).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		b := newTodoBoard()
		return b, saveTodoBoard(ctx, tx, team, b)
	}
	if err != nil {
		return nil, err
	}
	var b TodoBoard
	err = json.Unmarshal(raw, &b)
	if b.Operations == nil {
		b.Operations = map[string]TodoReplay{}
	}
	return &b, err
}
func saveTodoBoard(ctx context.Context, tx pgx.Tx, team string, b *TodoBoard) error {
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO todo_boards(team_id,document) VALUES($1,$2) ON CONFLICT(team_id) DO UPDATE SET document=EXCLUDED.document,updated_at=now()`, team, raw)
	return err
}
func todoSnapshot(t Todo) json.RawMessage {
	t.History = nil
	t.Comments = nil
	raw, _ := json.Marshal(t)
	return raw
}
func recordTodo(p identity.Principal, t *Todo, before Todo, action string, source ...string) {
	t.Revision++
	t.UpdatedAt = time.Now().UTC()
	agent, model := "", ""
	if p.Kind == "token" && len(source) >= 2 {
		agent = source[0]
		model = source[1]
	}
	t.History = append(t.History, TodoEvent{ID: store.ID(), ActorID: p.UserID, ActorKind: p.Kind, Agent: agent, Model: model, Action: action, CreatedAt: t.UpdatedAt, Before: todoSnapshot(before), After: todoSnapshot(*t)})
}
func replayTodo(b *TodoBoard, p identity.Principal, id string, input any, out any) (bool, error) {
	if len(id) > 160 {
		return false, identity.Invalid("操作标识过长")
	}
	if id == "" {
		return false, identity.Invalid("请提供 operation_id")
	}
	raw, _ := json.Marshal(input)
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	if v, ok := b.Operations[p.UserID+":"+id]; ok {
		if v.Hash != hash {
			return false, todoConflict()
		}
		return true, json.Unmarshal(v.Result, out)
	}
	return false, nil
}
func saveTodoReplay(b *TodoBoard, p identity.Principal, id string, input, out any) {
	raw, _ := json.Marshal(input)
	result, _ := json.Marshal(out)
	b.Operations[p.UserID+":"+id] = TodoReplay{fmt.Sprintf("%x", sha256.Sum256(raw)), result}
}
func (s *Service) TodoBoard(ctx context.Context, p identity.Principal) (TodoBoard, error) {
	var out TodoBoard
	err := s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error { out = *b; out.Tasks = nil; out.Operations = nil; return nil })
	return out, err
}
func (s *Service) Todos(ctx context.Context, p identity.Principal) ([]Todo, error) {
	out := []Todo{}
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		for _, t := range b.Tasks {
			t.History = nil
			t.Comments = nil
			t.ReportIDs = []string{}
			out = append(out, t)
		}
		return nil
	})
	return out, err
}
func (s *Service) GetTodo(ctx context.Context, p identity.Principal, id string) (Todo, error) {
	var out Todo
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		t := b.task(id)
		if t == nil {
			return store.ErrNotFound
		}
		out = *t
		out.Comments = append([]TodoComment{}, t.Comments...)
		for i := range out.Comments {
			if out.Comments[i].Deleted {
				out.Comments[i].Body = ""
				out.Comments[i].Mentions = nil
			}
		}
		out.ReportIDs = []string{}
		out.UnavailableReports = 0
		for _, rid := range t.ReportIDs {
			if tx == nil {
				out.ReportIDs = append(out.ReportIDs, rid)
				continue
			}
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL)`, p.TeamID, rid).Scan(&ok); err != nil {
				return err
			}
			if !ok && p.Can("reports:read") {
				out.UnavailableReports++
			}
			if ok && p.Can("reports:read") {
				out.ReportIDs = append(out.ReportIDs, rid)
			}
		}
		return nil
	})
	return out, err
}
func validateTodo(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, t *Todo, old *Todo) error {
	t.Title = strings.TrimSpace(t.Title)
	if t.Title == "" || len(t.Title) > 500 || len(t.Body) > 50000 {
		return identity.Invalid("任务标题或描述长度无效")
	}
	c := b.column(t.ColumnID)
	if c == nil || c.Archived {
		return identity.Invalid("请选择有效任务列")
	}
	if t.Priority == "" {
		t.Priority = "none"
	}
	if t.Priority != "none" && t.Priority != "low" && t.Priority != "medium" && t.Priority != "high" {
		return identity.Invalid("优先级无效")
	}
	if t.DueDate != "" {
		if _, err := time.Parse("2006-01-02", t.DueDate); err != nil {
			return identity.Invalid("截止日期无效")
		}
	}
	if len(t.Links) > 20 || len(t.Domains) > 20 || len(t.SourceID) > 160 || len(t.Agent) > 160 || len(t.Model) > 160 {
		return identity.Invalid("任务字段过长")
	}
	for _, l := range t.Links {
		u, e := url.Parse(l.URL)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return identity.Invalid("请使用 HTTP 或 HTTPS 链接")
		}
	}
	if t.Domains == nil {
		t.Domains = []string{}
	}
	if t.Links == nil {
		t.Links = []store.Link{}
	}
	if t.ReportIDs == nil {
		t.ReportIDs = []string{}
	}
	if tx != nil {
		if t.AssigneeID != "" {
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, p.TeamID, t.AssigneeID).Scan(&ok); err != nil {
				return err
			}
			if !ok && (old == nil || old.AssigneeID != t.AssigneeID) {
				return identity.Invalid("负责人不在当前团队")
			}
		}
		list, err := categories(ctx, tx, p.TeamID)
		if err != nil {
			return err
		}
		if t.ProjectID != "" {
			v, ok := find(list, "project", t.ProjectID, "")
			if !ok || v.State != "active" && (old == nil || old.ProjectID != t.ProjectID) {
				return identity.Invalid("请选择有效项目")
			}
		}
		seen := map[string]bool{}
		ds := []string{}
		for _, d := range t.Domains {
			v, ok := find(list, "domain", "", d)
			if !ok || v.State != "active" && (old == nil || !stringIn(old.Domains, d)) {
				return identity.Invalid("请选择有效领域")
			}
			if !seen[v.Name] {
				ds = append(ds, v.Name)
				seen[v.Name] = true
			}
		}
		t.Domains = ds
	}
	return nil
}
func stringIn(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
func todoMove(b *TodoBoard, t *Todo, column, before, after string) error {
	c := b.column(column)
	if c == nil || c.Archived {
		return identity.Invalid("请选择有效任务列")
	}
	if before != "" && after != "" {
		return identity.Invalid("只允许一个排序锚点")
	}
	now := time.Now().UTC()
	if t.ColumnID != column {
		old := b.column(t.ColumnID)
		if old != nil && !old.Done {
			t.PreviousColumnID = old.ID
		}
		t.ColumnID = column
	}
	if c.Done && t.CompletedAt == nil {
		t.CompletedAt = &now
	}
	if !c.Done {
		t.CompletedAt = nil
	}
	items := []*Todo{}
	for i := range b.Tasks {
		v := &b.Tasks[i]
		if v.ID != t.ID && v.ColumnID == column {
			items = append(items, v)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Position < items[j].Position })
	idx := len(items)
	anchor := before
	if anchor == "" {
		anchor = after
	}
	if anchor != "" {
		idx = -1
		for i, v := range items {
			if v.ID == anchor {
				idx = i
				if after != "" {
					idx++
				}
				break
			}
		}
		if idx < 0 {
			return todoConflict()
		}
	}
	items = append(items, nil)
	copy(items[idx+1:], items[idx:])
	items[idx] = t
	for i, v := range items {
		v.Position = i + 1
	}
	return nil
}
func todoNotify(ctx context.Context, tx pgx.Tx, p identity.Principal, t Todo, ids []string, kind string) error {
	if tx == nil {
		return nil
	}
	seen := map[string]bool{p.UserID: true}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		_, err := tx.Exec(ctx, `INSERT INTO notifications(id,team_id,user_id,report_id,todo_id,kind,title) SELECT $1,$2,$3,NULL,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM memberships WHERE team_id=$2 AND user_id=$3)`, store.ID(), p.TeamID, id, t.ID, kind, t.Title)
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) ChangeTodo(ctx context.Context, p identity.Principal, id string, in TodoInput) (Todo, error) {
	var out Todo
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		replay, err := replayTodo(b, p, in.OperationID, struct {
			ID     string
			Input  TodoInput
			Fields map[string]json.RawMessage
		}{id, in, in.Fields}, &out)
		if err != nil || replay {
			return err
		}
		if id == "" {
			if in.SourceID == "" {
				return identity.Invalid("请提供 source_id")
			}
			for _, t := range b.Tasks {
				if t.CreatorID == p.UserID && t.SourceID == in.SourceID {
					out = t
					saveTodoReplay(b, p, in.OperationID, struct {
						ID     string
						Input  TodoInput
						Fields map[string]json.RawMessage
					}{id, in, in.Fields}, out)
					return nil
				}
			}
			t := in.Todo
			t.UnavailableReports = 0
			t.ID = store.ID()
			t.CreatorID = p.UserID
			t.Revision = 0
			t.Archived = false
			t.History = []TodoEvent{}
			t.Comments = []TodoComment{}
			t.ReportIDs = append([]string{}, in.ReportIDs...)
			if len(t.ReportIDs) > 0 {
				if !p.Can("reports:read") {
					return identity.Denied("需要 reports:read 权限")
				}
				if len(t.ReportIDs) > 20 {
					return identity.Invalid("最多关联 20 条简报")
				}
				if tx != nil {
					for _, rid := range t.ReportIDs {
						var ok bool
						if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL)`, p.TeamID, rid).Scan(&ok); err != nil {
							return err
						}
						if !ok {
							return store.ErrNotFound
						}
					}
				}
			}
			t.CollaborationID = ""
			t.CompletedAt = nil
			t.PreviousColumnID = ""
			t.CreatedAt = time.Now().UTC()
			if err = validateTodo(ctx, tx, p, b, &t, nil); err != nil {
				return err
			}
			b.Tasks = append(b.Tasks, t)
			v := &b.Tasks[len(b.Tasks)-1]
			if err = todoMove(b, v, t.ColumnID, "", ""); err != nil {
				return err
			}
			recordTodo(p, v, Todo{}, "created", in.Agent, in.Model)
			b.Revision++
			out = *v
			if err = todoNotify(ctx, tx, p, out, []string{out.AssigneeID}, "todo-assigned"); err != nil {
				return err
			}
		} else {
			t := b.task(id)
			if t == nil {
				return store.ErrNotFound
			}
			if in.Action != "comment" && in.Action != "delete-comment" && in.Action != "restore-comment" && !todoWrite(p, *t) {
				return identity.Denied("无权维护此任务")
			}
			if in.ExpectedRevision != t.Revision {
				return todoConflict()
			}
			before := *t
			switch in.Action {
			case "comment":
				body := strings.TrimSpace(in.Body)
				if body == "" || len(body) > 10000 || len(in.Mentions) > 50 {
					return identity.Invalid("评论长度无效")
				}
				if tx != nil {
					for _, member := range in.Mentions {
						var ok bool
						if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, p.TeamID, member).Scan(&ok); e != nil {
							return e
						}
						if !ok {
							return identity.Invalid("提醒成员不在当前团队")
						}
					}
				}
				t.Comments = append(t.Comments, TodoComment{ID: store.ID(), AuthorID: p.UserID, Body: body, Mentions: in.Mentions, CreatedAt: time.Now().UTC()})
				if err = todoNotify(ctx, tx, p, *t, append(in.Mentions, t.AssigneeID, t.CreatorID), "todo-comment"); err != nil {
					return err
				}
			case "delete-comment", "restore-comment":
				if p.Kind != "session" && p.Kind != "demo" {
					return identity.Denied("无权维护此任务")
				}
				found := false
				for i := range t.Comments {
					c := &t.Comments[i]
					if c.ID == in.CommentID {
						found = true
						if c.AuthorID != p.UserID && !todoAdmin(p) {
							return identity.Denied("无权维护此任务")
						}
						c.Deleted = in.Action == "delete-comment"
					}
				}
				if !found {
					return store.ErrNotFound
				}
			case "archive":
				t.Archived = true
			case "restore":
				t.Archived = false
			case "move", "complete", "reopen":
				if in.BoardRevision != b.Revision {
					return todoConflict()
				}
				col := in.ColumnID
				if in.Action == "complete" {
					col = b.DefaultDoneID
				}
				if in.Action == "reopen" {
					col = t.PreviousColumnID
					c := b.column(col)
					if c == nil || c.Done || c.Archived {
						col = ""
						for _, v := range b.Columns {
							if !v.Done && !v.Archived {
								col = v.ID
								break
							}
						}
					}
				}
				if err = todoMove(b, t, col, in.BeforeID, in.AfterID); err != nil {
					return err
				}
				b.Revision++
			case "", "edit":
				candidate := *t
				if _, ok := in.Fields["title"]; ok {
					candidate.Title = in.Title
				}
				if _, ok := in.Fields["body"]; ok {
					candidate.Body = in.Body
				}
				if _, ok := in.Fields["assignee_id"]; ok {
					candidate.AssigneeID = in.AssigneeID
				}
				if _, ok := in.Fields["project_id"]; ok {
					candidate.ProjectID = in.ProjectID
				}
				if _, ok := in.Fields["domains"]; ok {
					candidate.Domains = in.Domains
				}
				if _, ok := in.Fields["priority"]; ok {
					candidate.Priority = in.Priority
				}
				if _, ok := in.Fields["due_date"]; ok {
					candidate.DueDate = in.DueDate
				}
				if _, ok := in.Fields["links"]; ok {
					candidate.Links = in.Links
				}
				if _, ok := in.Fields["agent"]; ok {
					candidate.Agent = in.Agent
				}
				if _, ok := in.Fields["model"]; ok {
					candidate.Model = in.Model
				}
				if err = validateTodo(ctx, tx, p, b, &candidate, t); err != nil {
					return err
				}
				*t = candidate
			default:
				return identity.Invalid("任务操作无效")
			}
			recordTodo(p, t, before, in.Action, in.Agent, in.Model)
			out = *t
			if before.AssigneeID != t.AssigneeID || before.CompletedAt == nil && t.CompletedAt != nil || before.CompletedAt != nil && t.CompletedAt == nil {
				if err = todoNotify(ctx, tx, p, *t, []string{t.AssigneeID, t.CreatorID}, "todo-updated"); err != nil {
					return err
				}
			}
		}
		saveTodoReplay(b, p, in.OperationID, struct {
			ID     string
			Input  TodoInput
			Fields map[string]json.RawMessage
		}{id, in, in.Fields}, out)
		return nil
	})
	return out, err
}
func (s *Service) ChangeTodoColumn(ctx context.Context, p identity.Principal, id string, in ColumnInput) (TodoBoard, error) {
	var out TodoBoard
	if !todoAdmin(p) {
		return out, store.ErrForbidden
	}
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		replay, err := replayTodo(b, p, in.OperationID, struct {
			ID    string
			Input ColumnInput
		}{id, in}, &out)
		if err != nil || replay {
			return err
		}
		beforeColumns, _ := json.Marshal(struct {
			Columns []TodoColumn
			Default string
		}{b.Columns, b.DefaultDoneID})
		if in.BoardRevision != b.Revision {
			return todoConflict()
		}
		if in.Action == "order" {
			if len(in.IDs) != len(b.Columns) {
				return identity.Invalid("列顺序无效")
			}
			cs := []TodoColumn{}
			seen := map[string]bool{}
			for _, cid := range in.IDs {
				c := b.column(cid)
				if c == nil || seen[cid] {
					return identity.Invalid("列顺序无效")
				}
				seen[cid] = true
				cs = append(cs, *c)
			}
			b.Columns = cs
		} else if in.Action == "default" {
			c := b.column(id)
			if c == nil || !c.Done || c.Archived {
				return identity.Invalid("请选择完成列")
			}
			b.DefaultDoneID = id
		} else if id == "" {
			if !validName(in.Name) {
				return identity.Invalid("列名称无效")
			}
			b.Columns = append(b.Columns, TodoColumn{0, store.ID(), strings.TrimSpace(in.Name), in.Done, false, 1})
		} else {
			c := b.column(id)
			if c == nil {
				return store.ErrNotFound
			}
			if c.Revision != in.ExpectedRevision {
				return todoConflict()
			}
			switch in.Action {
			case "archive":
				if id == b.DefaultDoneID {
					return identity.Invalid("请先设置另一个默认完成列")
				}
				dest := b.column(in.TargetID)
				has := false
				for _, t := range b.Tasks {
					if t.ColumnID == id {
						has = true
					}
				}
				if has && (dest == nil || dest.Archived || dest.ID == id) {
					return identity.Invalid("请选择迁移目标列")
				}
				tasks := []*Todo{}
				for i := range b.Tasks {
					if b.Tasks[i].ColumnID == id {
						tasks = append(tasks, &b.Tasks[i])
					}
				}
				sort.SliceStable(tasks, func(i, j int) bool { return tasks[i].Position < tasks[j].Position })
				for _, t := range tasks {
					before := *t
					if err = todoMove(b, t, in.TargetID, "", ""); err != nil {
						return err
					}
					recordTodo(p, t, before, "column-migration")
				}
				c.Archived = true
			case "restore":
				c.Archived = false
			case "", "edit":
				if !validName(in.Name) {
					return identity.Invalid("列名称无效")
				}
				if id == b.DefaultDoneID && !in.Done {
					return identity.Invalid("请先设置另一个默认完成列")
				}
				changed := c.Done != in.Done
				c.Name = strings.TrimSpace(in.Name)
				c.Done = in.Done
				if changed {
					for i := range b.Tasks {
						t := &b.Tasks[i]
						if t.ColumnID == id {
							before := *t
							if in.Done {
								now := time.Now().UTC()
								t.CompletedAt = &now
							} else {
								t.CompletedAt = nil
							}
							recordTodo(p, t, before, "column-completion")
						}
					}
				}
			default:
				return identity.Invalid("列操作无效")
			}
			c.Revision++
		}
		active, done := 0, 0
		for _, c := range b.Columns {
			if !c.Archived {
				if c.Done {
					done++
				} else {
					active++
				}
			}
		}
		if active == 0 || done == 0 {
			return identity.Invalid("至少保留一个未完成列和一个完成列")
		}
		afterColumns, _ := json.Marshal(struct {
			Columns []TodoColumn
			Default string
		}{b.Columns, b.DefaultDoneID})
		b.History = append(b.History, TodoEvent{ID: store.ID(), ActorID: p.UserID, ActorKind: p.Kind, Action: "column:" + in.Action, Before: beforeColumns, After: afterColumns, CreatedAt: time.Now().UTC()})
		b.Revision++
		out = *b
		out.Columns = append([]TodoColumn{}, b.Columns...)
		for i := range out.Columns {
			for _, t := range b.Tasks {
				if t.ColumnID == out.Columns[i].ID {
					out.Columns[i].TaskCount++
				}
			}
		}
		out.Tasks = nil
		out.Operations = nil
		saveTodoReplay(b, p, in.OperationID, struct {
			ID    string
			Input ColumnInput
		}{id, in}, out)
		return nil
	})
	return out, err
}

func (s *Service) TransferCollaboration(ctx context.Context, p identity.Principal, id string, in TodoInput) (Todo, error) {
	var out Todo
	if s.TodoDemo != nil {
		return out, identity.Invalid("演示协作不可转交")
	}
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		var author, assignee, title, body, report, existing string
		err := tx.QueryRow(ctx, `SELECT author_id,assignee_id,title,body,report_id,todo_id FROM collaboration_requests WHERE team_id=$1 AND id=$2 AND report_id IN(SELECT id FROM reports WHERE team_id=$1 AND deleted_at IS NULL) FOR UPDATE`, p.TeamID, id).Scan(&author, &assignee, &title, &body, &report, &existing)
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		if author != p.UserID && assignee != p.UserID && !todoAdmin(p) {
			return identity.Denied("无权维护此任务")
		}
		if existing != "" {
			t := b.task(existing)
			if t == nil {
				return store.ErrNotFound
			}
			out = *t
			return nil
		}
		t := Todo{ID: store.ID(), SourceID: "collaboration:" + id, CreatorID: p.UserID, Title: title, Body: body, ColumnID: in.ColumnID, AssigneeID: assignee, CollaborationID: id, ReportIDs: []string{report}, Comments: []TodoComment{}, History: []TodoEvent{}, CreatedAt: time.Now().UTC()}
		if err = validateTodo(ctx, tx, p, b, &t, nil); err != nil {
			return err
		}
		b.Tasks = append(b.Tasks, t)
		task := &b.Tasks[len(b.Tasks)-1]
		if err = todoMove(b, task, t.ColumnID, "", ""); err != nil {
			return err
		}
		recordTodo(p, task, Todo{}, "collaboration-transfer")
		b.Revision++
		out = *task
		if _, err = tx.Exec(ctx, `UPDATE collaboration_requests SET todo_id=$3,updated_at=now() WHERE team_id=$1 AND id=$2`, p.TeamID, id, out.ID); err != nil {
			return err
		}
		return todoNotify(ctx, tx, p, out, []string{assignee, author}, "todo-assigned")
	})
	return out, err
}

// ReportTodos runs inside the report transaction. No report reference is trusted from the client.
func reportTodos(ctx context.Context, tx pgx.Tx, p identity.Principal, r store.Report) error {
	if r.TodoIDs == nil && len(r.TodoMoves) == 0 {
		return nil
	}
	if !p.Can("todos:read") {
		return identity.Denied("需要 todos:read 权限")
	}
	if len(r.TodoIDs) > 20 || len(r.TodoMoves) > 20 {
		return identity.Invalid("最多关联 20 个任务")
	}
	b, err := loadTodoBoard(ctx, tx, p.TeamID)
	if err != nil {
		return err
	}
	var replayResult bool
	if len(r.TodoMoves) > 0 {
		if !p.Can("todos:write") {
			return identity.Denied("需要 todos:write 权限")
		}
		replay, err := replayTodo(b, p, r.OperationID, struct {
			Report string
			Moves  []store.TodoMove
		}{r.SourceID, r.TodoMoves}, &replayResult)
		if err != nil {
			return err
		}
		if replay {
			return nil
		}
	}
	for _, id := range r.TodoIDs {
		if b.task(id) == nil {
			return store.ErrNotFound
		}
	}
	for _, m := range r.TodoMoves {
		if !stringIn(r.TodoIDs, m.ID) {
			return identity.Invalid("移动任务必须关联本次简报")
		}
		t := b.task(m.ID)
		if t == nil {
			return store.ErrNotFound
		}
		if !todoWrite(p, *t) {
			return identity.Denied("无权维护此任务")
		}
		if t.Revision != m.ExpectedRevision {
			return todoConflict()
		}
		before := *t
		if err = todoMove(b, t, m.ColumnID, "", ""); err != nil {
			return err
		}
		recordTodo(p, t, before, "report-move", r.Agent, r.Model)
		b.Revision++
		if err = todoNotify(ctx, tx, p, *t, []string{t.CreatorID, t.AssigneeID}, "todo-report"); err != nil {
			return err
		}
	}
	for i := range b.Tasks {
		t := &b.Tasks[i]
		has := stringIn(t.ReportIDs, r.ID)
		wanted := stringIn(r.TodoIDs, t.ID)
		if has == wanted {
			continue
		}
		before := *t
		if wanted {
			t.ReportIDs = append(t.ReportIDs, r.ID)
		} else {
			ids := []string{}
			for _, rid := range t.ReportIDs {
				if rid != r.ID {
					ids = append(ids, rid)
				}
			}
			t.ReportIDs = ids
		}
		recordTodo(p, t, before, "report-link")
	}
	if len(r.TodoMoves) > 0 {
		saveTodoReplay(b, p, r.OperationID, struct {
			Report string
			Moves  []store.TodoMove
		}{r.SourceID, r.TodoMoves}, true)
	}
	return saveTodoBoard(ctx, tx, p.TeamID, b)
}
func (s *Service) ReportTodoIDs(ctx context.Context, p identity.Principal, report string) ([]string, error) {
	out := []string{}
	if !p.Can("todos:read") {
		return out, nil
	}
	err := s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error {
		for _, t := range b.Tasks {
			if stringIn(t.ReportIDs, report) {
				out = append(out, t.ID)
			}
		}
		return nil
	})
	return out, err
}
func reclassifyTodos(ctx context.Context, tx pgx.Tx, p identity.Principal, kind string, old, out Category) error {
	b, err := loadTodoBoard(ctx, tx, p.TeamID)
	if err != nil {
		return err
	}
	for i := range b.Tasks {
		t := &b.Tasks[i]
		before := *t
		changed := false
		if kind == "project" && t.ProjectID == old.ID {
			t.ProjectID = out.ID
			changed = true
		}
		if kind == "domain" {
			ds := []string{}
			for _, d := range t.Domains {
				if d == old.Name {
					d = out.Name
					changed = true
				}
				if !stringIn(ds, d) {
					ds = append(ds, d)
				}
			}
			t.Domains = ds
		}
		if changed {
			recordTodo(p, t, before, "classification")
		}
	}
	return saveTodoBoard(ctx, tx, p.TeamID, b)
}

func reportOperationKey(r store.Report) string { return "report-submit:" + r.OperationID }
func reportOperationInput(r store.Report) store.Report {
	r.ID = ""
	r.TeamID = ""
	r.AuthorID = ""
	r.CreatedAt = time.Time{}
	r.UpdatedAt = time.Time{}
	r.Comments = nil
	return r
}
func beginReportOperation(ctx context.Context, tx pgx.Tx, p identity.Principal, r store.Report, out *store.Report) (bool, error) {
	if len(r.TodoMoves) == 0 {
		return false, nil
	}
	if !p.Can("todos:read") || !p.Can("todos:write") {
		return false, identity.Denied("需要任务写入和简报读取权限")
	}
	var deleted bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reports WHERE team_id=$1 AND author_id=$2 AND source_id=$3 AND deleted_at IS NOT NULL)`, p.TeamID, p.UserID, r.SourceID).Scan(&deleted); e != nil {
		return false, e
	}
	if deleted {
		return false, &identity.Error{Status: 409, Message: "简报已删除，请先在网页回收站恢复"}
	}
	if r.OperationID == "" {
		return false, identity.Invalid("联合上报需要 operation_id")
	}
	b, e := loadTodoBoard(ctx, tx, p.TeamID)
	if e != nil {
		return false, e
	}
	return replayTodo(b, p, reportOperationKey(r), reportOperationInput(r), out)
}
func finishReportOperation(ctx context.Context, tx pgx.Tx, p identity.Principal, r, out store.Report) error {
	if len(r.TodoMoves) == 0 {
		return nil
	}
	// Merge notifications produced by this transaction for each recipient, retaining both links.
	_, err := tx.Exec(ctx, `UPDATE notifications n SET report_id=$3 WHERE n.team_id=$1 AND n.kind='todo-report' AND n.created_at=now() AND n.todo_id=ANY($2)`, p.TeamID, r.TodoIDs, out.ID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM notifications n USING notifications keep WHERE n.team_id=$1 AND keep.team_id=n.team_id AND n.user_id=keep.user_id AND n.created_at=now() AND keep.created_at=now() AND n.report_id=$2 AND keep.report_id=$2 AND (n.todo_id='' AND keep.todo_id<>'' OR n.todo_id<>'' AND keep.todo_id<>'' AND n.id>keep.id)`, p.TeamID, out.ID)
	if err != nil {
		return err
	}
	b, err := loadTodoBoard(ctx, tx, p.TeamID)
	if err != nil {
		return err
	}
	saveTodoReplay(b, p, reportOperationKey(r), reportOperationInput(r), out)
	return saveTodoBoard(ctx, tx, p.TeamID, b)
}

// Local demo uses its own in-memory board and repository, never team storage.
func (s *Service) SaveDemoReport(ctx context.Context, p identity.Principal, repo store.Repository, r store.Report) (store.Report, error) {
	var out store.Report
	err := s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error {
		if len(r.TodoMoves) > 0 {
			var cached store.Report
			replay, e := replayTodo(b, p, reportOperationKey(r), reportOperationInput(r), &cached)
			if e != nil {
				return e
			}
			if replay {
				out = cached
				return nil
			}
		}
		for _, id := range r.TodoIDs {
			if b.task(id) == nil {
				return store.ErrNotFound
			}
		}
		for _, m := range r.TodoMoves {
			t := b.task(m.ID)
			if t == nil || !stringIn(r.TodoIDs, m.ID) {
				return store.ErrNotFound
			}
			if t.Revision != m.ExpectedRevision {
				return todoConflict()
			}
			before := *t
			if e := todoMove(b, t, m.ColumnID, "", ""); e != nil {
				return e
			}
			recordTodo(p, t, before, "report-move", r.Agent, r.Model)
			b.Revision++
		}
		var e error
		out, e = repo.Save(ctx, r)
		if e != nil {
			return e
		}
		out.TodoIDs = r.TodoIDs
		if r.TodoIDs != nil {
			for i := range b.Tasks {
				t := &b.Tasks[i]
				before := *t
				had, want := stringIn(t.ReportIDs, out.ID), stringIn(r.TodoIDs, t.ID)
				if had == want {
					continue
				}
				ids := []string{}
				for _, id := range t.ReportIDs {
					if id != out.ID {
						ids = append(ids, id)
					}
				}
				if want {
					ids = append(ids, out.ID)
				}
				t.ReportIDs = ids
				recordTodo(p, t, before, "report-link")
			}
		}
		if len(r.TodoMoves) > 0 {
			saveTodoReplay(b, p, reportOperationKey(r), reportOperationInput(r), out)
		}
		return nil
	})
	return out, err
}

func (in *TodoInput) UnmarshalJSON(raw []byte) error {
	type plain TodoInput
	var p plain
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	*in = TodoInput(p)
	return json.Unmarshal(raw, &in.Fields)
}

type TodoCompletion struct {
	ProjectID   string    `json:"project_id"`
	Domains     []string  `json:"domains"`
	CreatorID   string    `json:"creator_id"`
	Agent       string    `json:"agent"`
	TodoID      string    `json:"todo_id"`
	CompletedAt time.Time `json:"completed_at"`
	AssigneeID  string    `json:"assignee_id"`
}

func (s *Service) TodoCompletions(ctx context.Context, p identity.Principal) ([]TodoCompletion, error) {
	out := []TodoCompletion{}
	err := s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error {
		for _, t := range b.Tasks {
			for _, e := range t.History {
				var before, after Todo
				if err := json.Unmarshal(e.Before, &before); err != nil {
					return err
				}
				if err := json.Unmarshal(e.After, &after); err != nil {
					return err
				}
				if before.CompletedAt == nil && after.CompletedAt != nil {
					out = append(out, TodoCompletion{TodoID: t.ID, CompletedAt: e.CreatedAt, AssigneeID: after.AssigneeID, ProjectID: after.ProjectID, Domains: after.Domains, CreatorID: after.CreatorID, Agent: e.Agent})
				}
			}
		}
		return nil
	})
	return out, err
}

func (s *Service) ReportTodoMap(ctx context.Context, p identity.Principal) (map[string][]string, error) {
	out := map[string][]string{}
	if !p.Can("todos:read") {
		return out, nil
	}
	err := s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error {
		for _, t := range b.Tasks {
			for _, id := range t.ReportIDs {
				out[id] = append(out[id], t.ID)
			}
		}
		return nil
	})
	return out, err
}
