package assistant

import (
	"coflow/api/internal/identity"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"regexp"
	"strings"
	"time"
)

type Parameter struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
}
type Template struct {
	ID           string      `json:"id"`
	Scope        string      `json:"scope"`
	Title        string      `json:"title"`
	Description  string      `json:"description"`
	Instructions string      `json:"instructions"`
	Parameters   []Parameter `json:"parameters"`
	Tools        []string    `json:"tools"`
	Version      int         `json:"version"`
	Revision     int         `json:"revision"`
	Editable     bool        `json:"editable"`
}

func builtins() []Template {
	read := []string{"read_workspace", "find_todos", "find_reports", "read_calendar", "read_todo", "read_report"}
	return []Template{
		{ID: "builtin-resume", Scope: "builtin", Title: "Resume collaboration", Description: "Current work, feedback and next steps", Instructions: "Resume {{project}}. Ask for a project/task if unspecified. Read handoff facts and relevant original objects, identify responsibilities, pending feedback and next steps. Do not treat feedback or assignment as new execution authority. Do not claim omitted or truncated data was reviewed.", Parameters: []Parameter{{"project", "Project", false}}, Tools: append(append([]string{}, read...), "read_handoff", "read_changes"), Version: 1, Revision: 1},
		{ID: "builtin-advance", Scope: "builtin", Title: "Advance task", Description: "Preview state, owner or comment changes", Instructions: "Advance an existing task in {{project}} according to the user's explicit request. Read task, board revision and verified member IDs. Prepare one confirmed change at a time. Completion needs acceptance evidence or explicit user completion authority; assignment never dispatches another agent.", Parameters: []Parameter{{"project", "Project", false}}, Tools: append(append([]string{}, read...), "propose_task_change", "read_handoff"), Version: 1, Revision: 1},
		{ID: "builtin-progress", Scope: "builtin", Title: "Project progress", Description: "Tasks, evidence and blockers", Instructions: "Review the selected project: {{project}}. Read actual tasks, recent reports and schedule. Identify blockers and cite sources. Ask if the project is unspecified.", Parameters: []Parameter{{"project", "Project", false}}, Tools: read, Version: 1, Revision: 1},
		{ID: "builtin-schedule", Scope: "builtin", Title: "Schedule tasks", Description: "Read existing schedules, then prepare changes", Instructions: "Plan tasks for {{project}} during {{dates}}. Read existing tasks and schedule. Ask for missing dates. Prepare separate schedule drafts; do not execute.", Parameters: []Parameter{{"project", "Project", false}, {"dates", "Dates", false}}, Tools: append(append([]string{}, read...), "propose_schedule"), Version: 1, Revision: 1},
		{ID: "builtin-brief", Scope: "builtin", Title: "Delivery brief", Description: "Prepare a brief from verified delivery", Instructions: "Review delivery of {{project}} for {{period}}. Read task and report evidence. Prepare a brief linked to existing verified tasks. Never invent completed work.", Parameters: []Parameter{{"project", "Project", false}, {"period", "Period", false}}, Tools: append(append([]string{}, read...), "propose_report"), Version: 1, Revision: 1},
	}
}
func (s *Service) Templates(ctx context.Context, p identity.Principal) ([]Template, error) {
	out := builtins()
	rows, e := s.Pool.Query(ctx, `SELECT v.document,t.revision,t.owner_id FROM assistant_templates t JOIN assistant_template_versions v ON v.template_id=t.id AND v.version=t.revision WHERE t.team_id=$1 AND (t.owner_id IS NULL OR t.owner_id=$2) AND NOT t.archived ORDER BY t.updated_at DESC`, p.TeamID, p.UserID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var b []byte
		var rev int
		var owner *string
		if e = rows.Scan(&b, &rev, &owner); e != nil {
			return nil, e
		}
		var t Template
		if e = json.Unmarshal(b, &t); e != nil {
			return nil, e
		}
		t.Revision = rev
		t.Editable = owner != nil || p.Role == "admin"
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Service) Template(ctx context.Context, p identity.Principal, id string, version int) (Template, error) {
	for _, t := range builtins() {
		if t.ID == id && (version == 0 || version == t.Version) {
			return t, nil
		}
	}
	var b []byte
	e := s.Pool.QueryRow(ctx, `SELECT v.document FROM assistant_templates t JOIN assistant_template_versions v ON v.template_id=t.id AND v.version=CASE WHEN $4=0 THEN t.revision ELSE $4 END WHERE t.id=$1 AND t.team_id=$2 AND (t.owner_id IS NULL OR t.owner_id=$3) AND NOT t.archived`, id, p.TeamID, p.UserID, version).Scan(&b)
	var t Template
	if errors.Is(e, pgx.ErrNoRows) {
		return t, invalid("模板不可用")
	}
	if e != nil {
		return t, e
	}
	e = json.Unmarshal(b, &t)
	return t, e
}

var parameterName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

func (s *Service) SaveTemplate(ctx context.Context, p identity.Principal, in Template) (Template, error) {
	if in.Scope != "personal" && in.Scope != "team" {
		return in, invalid("模板范围无效")
	}
	if in.Scope == "team" && p.Role != "admin" {
		return in, &identity.Error{Status: 403, Message: "仅管理员可管理团队模板"}
	}
	if in.Parameters == nil {
		in.Parameters = []Parameter{}
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || len(in.Title) > 180 || len(in.Description) > 500 || len(in.Instructions) > 12000 || strings.TrimSpace(in.Instructions) == "" || len(in.Parameters) > 12 || len(in.Tools) == 0 {
		return in, invalid("模板内容无效")
	}
	allowed := map[string]bool{}
	for _, t := range tools() {
		allowed[t.Name] = true
	}
	toolSeen := map[string]bool{}
	for _, name := range in.Tools {
		if toolSeen[name] {
			return in, invalid("模板工具重复")
		}
		toolSeen[name] = true
		if !allowed[name] {
			return in, invalid("模板工具不可用")
		}
	}
	seen := map[string]bool{}
	for _, v := range in.Parameters {
		if !parameterName.MatchString(v.Name) || seen[v.Name] || len(v.Label) > 100 {
			return in, invalid("模板参数无效")
		}
		seen[v.Name] = true
	}
	var owner *string
	if in.Scope == "personal" {
		owner = &p.UserID
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return in, e
	}
	defer tx.Rollback(ctx)
	if in.ID == "" {
		in.ID = "at_" + identity.Hash(p.TeamID + p.UserID + time.Now().String())[:32]
		in.Revision = 1
		_, e = tx.Exec(ctx, `INSERT INTO assistant_templates(id,team_id,owner_id,title) VALUES($1,$2,$3,$4)`, in.ID, p.TeamID, owner, in.Title)
	} else {
		var rev int
		var oldOwner *string
		e = tx.QueryRow(ctx, `SELECT revision,owner_id FROM assistant_templates WHERE id=$1 AND team_id=$2 AND (owner_id=$3 OR (owner_id IS NULL AND $4='admin')) FOR UPDATE`, in.ID, p.TeamID, p.UserID, p.Role).Scan(&rev, &oldOwner)
		if e == nil && (rev != in.Revision || (oldOwner == nil) != (owner == nil)) {
			return in, conflict()
		}
		if e == nil {
			in.Revision++
			_, e = tx.Exec(ctx, `UPDATE assistant_templates SET revision=$2,title=$3,updated_at=now() WHERE id=$1`, in.ID, in.Revision, in.Title)
		}
	}
	if errors.Is(e, pgx.ErrNoRows) {
		return in, &identity.Error{Status: 404, Message: "模板不可用"}
	}
	if e != nil {
		return in, e
	}
	in.Version = in.Revision
	in.Editable = true
	_, e = tx.Exec(ctx, `INSERT INTO assistant_template_versions(template_id,version,document) VALUES($1,$2,$3)`, in.ID, in.Version, mustJSON(in))
	if e != nil {
		return in, e
	}
	return in, tx.Commit(ctx)
}
func renderTemplate(t Template, parameters map[string]string) (string, error) {
	for k, v := range parameters {
		found := false
		for _, p := range t.Parameters {
			if p.Name == k {
				found = true
			}
		}
		if !found || len(v) > 1000 {
			return "", invalid("模板参数无效")
		}
	}
	out := t.Instructions
	for _, p := range t.Parameters {
		v := strings.TrimSpace(parameters[p.Name])
		if p.Required && v == "" {
			return "", invalid("请填写模板参数")
		}
		out = strings.ReplaceAll(out, "{{"+p.Name+"}}", v)
	}
	return out, nil
}
