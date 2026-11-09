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

// A task dependency resolves only from the original task. Manual waiting conditions
// require an explicit resolution by a task maintainer; neither dispatches work.
type TodoBlocker struct {
	ID              string     `json:"id"`
	TodoID          string     `json:"todo_id"`
	WaitingMemberID string     `json:"waiting_member_id"`
	Condition       string     `json:"condition"`
	ResolvedAt      *time.Time `json:"resolved_at,omitempty"`
}

func blocked(b *TodoBoard, t Todo) bool {
	for _, v := range t.Blockers {
		if v.TodoID != "" {
			x := b.task(v.TodoID)
			if x == nil || x.Archived || x.CompletedAt == nil {
				return true
			}
		} else if v.ResolvedAt == nil {
			return true
		}
	}
	return false
}
func validateBlockers(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, t *Todo) error {
	if len(t.Blockers) > 20 {
		return identity.Invalid("最多 20 项阻塞")
	}
	seen := map[string]bool{}
	for i := range t.Blockers {
		v := &t.Blockers[i]
		v.Condition = strings.TrimSpace(v.Condition)
		if v.ID == "" {
			v.ID = store.ID()
		}
		if seen[v.ID] || len(v.Condition) > 2000 || v.TodoID == "" && v.Condition == "" {
			return identity.Invalid("阻塞条件无效")
		}
		seen[v.ID] = true
		if v.TodoID != "" {
			x := b.task(v.TodoID)
			if x == nil || x.Archived || x.ID == t.ID {
				return identity.Invalid("请选择其他有效任务")
			}
			v.ResolvedAt = nil
		}
		if v.WaitingMemberID != "" {
			if e := validMember(ctx, tx, p.TeamID, v.WaitingMemberID); e != nil {
				return e
			}
		}
	}
	// Walk the candidate graph rather than trusting the client's cached graph.
	visiting, done := map[string]bool{}, map[string]bool{}
	var walk func(string) bool
	walk = func(id string) bool {
		if visiting[id] {
			return false
		}
		if done[id] {
			return true
		}
		visiting[id] = true
		x := b.task(id)
		if id == t.ID {
			x = t
		}
		if x != nil {
			for _, v := range x.Blockers {
				if v.TodoID != "" && !walk(v.TodoID) {
					return false
				}
			}
		}
		visiting[id] = false
		done[id] = true
		return true
	}
	if !walk(t.ID) {
		return identity.Invalid("任务依赖不能形成循环")
	}
	if t.CompletedAt != nil && blocked(b, *t) {
		return identity.Invalid("请先重新打开任务，再设置未解除的阻塞")
	}
	return nil
}
func blockersAllowCompletion(b *TodoBoard, t Todo) error {
	if blocked(b, t) {
		return identity.Invalid("任务仍有未解除的阻塞")
	}
	return nil
}
func validMember(ctx context.Context, tx pgx.Tx, team, id string) error {
	if tx == nil {
		for _, m := range store.Members {
			if m.ID == id {
				return nil
			}
		}
		return identity.Invalid("成员不在当前团队")
	}
	var ok bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, team, id).Scan(&ok); e != nil {
		return e
	}
	if !ok {
		return identity.Invalid("成员不在当前团队")
	}
	return nil
}

type Delegation struct {
	TaskProjectID string      `json:"task_project_id,omitempty"`
	ID            string      `json:"id"`
	GrantorID     string      `json:"grantor_id"`
	MemberID      string      `json:"member_id"`
	TodoID        string      `json:"todo_id"`
	ProjectID     string      `json:"project_id"`
	Actions       []string    `json:"actions"`
	ExpiresAt     time.Time   `json:"expires_at"`
	RevokedAt     *time.Time  `json:"revoked_at,omitempty"`
	Revision      int         `json:"revision"`
	CreatedAt     time.Time   `json:"created_at"`
	History       []TodoEvent `json:"history"`
}
type DelegationInput struct {
	Delegation
	ExpectedRevision int    `json:"expected_revision"`
	OperationID      string `json:"operation_id"`
	Action           string `json:"action"`
}

func (s *Service) Delegations(ctx context.Context, p identity.Principal) ([]Delegation, error) {
	out := []Delegation{}
	if !p.Can("todos:read") {
		return out, identity.Denied("需要 todos:read 权限")
	}
	e := s.todoTransaction(ctx, p, func(_ pgx.Tx, b *TodoBoard) error {
		for _, v := range b.Delegations {
			if v.GrantorID == p.UserID || v.MemberID == p.UserID || todoAdmin(p) {
				if t := b.task(v.TodoID); t != nil {
					v.TaskProjectID = t.ProjectID
				}
				out = append(out, v)
			}
		}
		return nil
	})
	return out, e
}
func (s *Service) ChangeDelegation(ctx context.Context, p identity.Principal, id string, in DelegationInput) (Delegation, error) {
	var out Delegation
	// A token may consume, but never grant or broaden, a human mandate.
	if p.Kind != "session" && p.Kind != "demo" {
		return out, identity.Denied("委托需由网页登录授权")
	}
	e := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		input := struct {
			ID    string
			Input DelegationInput
		}{id, in}
		if replay, e := replayTodo(b, p, in.OperationID, input, &out); e != nil {
			return e
		} else if replay {
			for _, d := range b.Delegations {
				if d.ID == out.ID {
					out = d
					return nil
				}
			}
			return store.ErrNotFound
		}
		if id == "" && in.Action != "" {
			return identity.Invalid("委托动作无效")
		}
		if id != "" {
			for i := range b.Delegations {
				v := &b.Delegations[i]
				if v.ID != id {
					continue
				}
				if v.GrantorID != p.UserID && !todoAdmin(p) {
					return identity.Denied("无权撤销委托")
				}
				if in.Action != "revoke" {
					return identity.Invalid("修改委托须先撤销再授权")
				}
				if v.Revision != in.ExpectedRevision {
					return todoConflict()
				}
				now := time.Now().UTC()
				v.RevokedAt = &now
				v.Revision++
				v.History = append(v.History, TodoEvent{ID: store.ID(), ActorID: p.UserID, ActorKind: p.Kind, Action: "revoke", CreatedAt: now})
				out = *v
				saveTodoReplay(b, p, in.OperationID, input, out)
				return nil
			}
			return store.ErrNotFound
		}
		v := in.Delegation
		v.TaskProjectID = ""
		v.ID = store.ID()
		v.GrantorID = p.UserID
		v.Revision = 1
		v.CreatedAt = time.Now().UTC()
		v.RevokedAt = nil
		v.History = nil
		if (v.TodoID == "") == (v.ProjectID == "") || len(v.Actions) == 0 || len(v.Actions) > 4 || !v.ExpiresAt.After(time.Now()) || v.ExpiresAt.After(time.Now().Add(90*24*time.Hour)) {
			return identity.Invalid("请指定单一任务或项目、成员、动作和 90 天内有效期")
		}
		if e := validMember(ctx, tx, p.TeamID, v.MemberID); e != nil {
			return e
		}
		if v.TodoID != "" {
			t := b.task(v.TodoID)
			if t == nil || t.Archived {
				return store.ErrNotFound
			}
			if !todoWrite(p, *t) {
				return identity.Denied("无权委托此任务")
			}
		} else {
			if !todoAdmin(p) {
				return identity.Denied("项目委托仅管理员授权")
			}
			if tx != nil {
				xs, e := categories(ctx, tx, p.TeamID)
				if e != nil {
					return e
				}
				x, ok := find(xs, "project", v.ProjectID, "")
				if !ok || x.State != "active" {
					return identity.Invalid("项目不可用")
				}
			}
		}
		seen := map[string]bool{}
		for _, a := range v.Actions {
			if !stringIn([]string{"edit", "move", "comment", "schedule"}, a) || seen[a] {
				return identity.Invalid("委托动作无效")
			}
			seen[a] = true
		}
		v.History = []TodoEvent{{ID: store.ID(), ActorID: p.UserID, ActorKind: p.Kind, Action: "grant", CreatedAt: v.CreatedAt}}
		b.Delegations = append(b.Delegations, v)
		out = v
		saveTodoReplay(b, p, in.OperationID, input, out)
		return nil
	})
	return out, e
}
func delegatedWrite(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, t Todo, in TodoInput) bool {
	if t.Archived {
		return false
	}
	action := in.Action
	if action == "" {
		action = "edit"
	}
	if action == "complete" || action == "reopen" {
		action = "move"
	}
	if action == "edit" {
		for k := range in.Fields {
			if stringIn([]string{"assignee_id", "project_id", "review", "agent", "model", "blockers"}, k) {
				return false
			}
		}
		if _, ok := in.Fields["schedule"]; ok {
			for k := range in.Fields {
				if !stringIn([]string{"schedule", "action", "expected_revision", "operation_id", "board_revision"}, k) {
					return false
				}
			}
			if len(in.Fields) > 5 {
				return false
			}
			action = "schedule"
		}
	}
	if !stringIn([]string{"edit", "move", "comment", "schedule"}, action) {
		return false
	}
	for _, d := range b.Delegations {
		if d.MemberID != p.UserID || d.RevokedAt != nil || !d.ExpiresAt.After(time.Now()) || !stringIn(d.Actions, action) || (d.TodoID != t.ID && (d.ProjectID == "" || d.ProjectID != t.ProjectID)) {
			continue
		}
		if tx == nil {
			if d.GrantorID == t.CreatorID || d.GrantorID == t.AssigneeID {
				return true
			}
			continue
		}
		var role string
		if e := tx.QueryRow(ctx, `SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2 FOR SHARE`, p.TeamID, d.GrantorID).Scan(&role); e == nil && (role == "admin" || d.ProjectID == "" && (d.GrantorID == t.CreatorID || d.GrantorID == t.AssigneeID)) {
			return true
		}
	}
	return false
}

func allowedTodoActions(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, t Todo) []string {
	out := []string{}
	for _, action := range []string{"edit", "move", "schedule"} {
		in := TodoInput{Action: action}
		if action == "schedule" {
			in.Action = "edit"
			in.Fields = map[string]json.RawMessage{"schedule": json.RawMessage(`null`)}
		}
		if p.Can("todos:write") && (todoWrite(p, t) || delegatedWrite(ctx, tx, p, b, t, in)) {
			out = append(out, action)
		}
	}
	return out
}
