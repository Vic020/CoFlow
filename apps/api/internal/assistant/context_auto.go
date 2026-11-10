package assistant

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/workspace"
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Browser-only one-click mandate. Never decoded as a Chat option or reused by jobs/tokens.
type ContextAutoInput struct {
	RequestID  string `json:"request_id"`
	ConfigID   string `json:"config_id"`
	Project    string `json:"project"`
	Domain     string `json:"domain"`
	Member     string `json:"member"`
	SourceKind string `json:"source_kind"`
	SourceID   string `json:"source_id"`
	Locale     string `json:"locale"`
	Mode       string `json:"mode"`
}
type ContextAutoResult struct {
	ConversationID string                   `json:"conversation_id"`
	Items          []workspace.ContextEntry `json:"items"`
	Errors         []string                 `json:"errors"`
	Reply          string                   `json:"reply"`
}
type contextAutoScope struct {
	input ContextAutoInput
	nodes map[string]workspace.ContextNode
}

func (s *Service) autoSource(ctx context.Context, p identity.Principal, kind, id string) (project string, domains []string, member string, err error) {
	switch kind {
	case "context":
		v, e := s.Workspace.GetContext(ctx, p, id)
		return v.ProjectID, v.Domains, v.CreatorID, e
	case "todo":
		v, e := s.Workspace.GetTodo(ctx, p, id)
		return v.ProjectID, v.Domains, v.AssigneeID, e
	case "report":
		if !p.Can("reports:read") {
			err = identity.Denied("需要 reports:read 权限")
			return
		}
		v, e := s.Repo.Get(ctx, p.TeamID, id)
		return v.ProjectID, append(v.Domains, v.Domain), v.AuthorID, e
	case "calendar":
		v, e := s.Workspace.GetCalendarEvent(ctx, p, id)
		return v.ProjectID, v.Domains, v.AssigneeID, e
	default:
		err = invalid("来源类型无效")
		return
	}
}
func (s *Service) checkAutoSource(ctx context.Context, p identity.Principal, scope *contextAutoScope, kind, id string) error {
	project, domains, member, e := s.autoSource(ctx, p, kind, id)
	if e != nil {
		return e
	}
	in := scope.input
	if in.Project != "" && in.Project != project || in.Domain != "" && !has(domains, in.Domain) || in.Member != "" && in.Member != member {
		return identity.Denied("AI 操作超出当前范围")
	}
	return nil
}
func (s *Service) guardAutoTool(ctx context.Context, p identity.Principal, scope *contextAutoScope, name string, a *ToolArgs) error {
	in := scope.input
	switch name {
	case "read_workspace":
		return nil
	case "read_context_tree", "find_context", "find_todos", "find_reports", "read_calendar":
		a.ProjectID = in.Project
		a.Domain = in.Domain
		a.MemberID = in.Member
		return nil
	case "read_context":
		return s.checkAutoSource(ctx, p, scope, "context", a.ContextID)
	case "read_todo":
		return s.checkAutoSource(ctx, p, scope, "todo", a.TodoID)
	case "read_report":
		return s.checkAutoSource(ctx, p, scope, "report", a.ReportID)
	case "read_calendar_event":
		return s.checkAutoSource(ctx, p, scope, "calendar", a.EventID)
	case "propose_context":
		if a.Knowledge == nil {
			return invalid("Context 草稿无效")
		}
		k := a.Knowledge
		if a.ContextID == "" {
			k.SourceID = "auto-context:" + identity.Hash(p.TeamID + ":" + p.UserID + ":" + k.ProjectID + ":" + k.Visibility + ":" + strings.ToLower(strings.TrimSpace(k.Title)))[:40]
		}
		if in.Project != "" && k.ProjectID != in.Project || in.Domain != "" && !has(k.Domains, in.Domain) {
			return identity.Denied("AI 操作超出当前范围")
		}
		// Reuse an unchanged same-title destination from this run's initial directory snapshot.
		if a.ContextID == "" {
			var match *workspace.ContextNode
			for _, n := range scope.nodes {
				if n.State != "archived" && n.ProjectID == k.ProjectID && n.Visibility == k.Visibility && strings.EqualFold(strings.TrimSpace(n.Title), strings.TrimSpace(k.Title)) && (n.CreatorID == p.UserID || p.Role == "admin" && n.Visibility == "team") {
					if match != nil {
						return invalid("同名文档有多个，请先核对")
					}
					node := n
					match = &node
				}
			}
			if match != nil {
				a.ContextID = match.ID
				a.ExpectedRevision = match.Revision
			}
		}
		if a.ContextID != "" {
			if e := s.checkAutoSource(ctx, p, scope, "context", a.ContextID); e != nil {
				return e
			}
			n, ok := scope.nodes[a.ContextID]
			if !ok || n.Revision != a.ExpectedRevision {
				return conflict()
			}
		}
		if len(k.Sources) == 0 && a.ContextID != in.SourceID {
			return invalid("AI 提取需要可追溯来源")
		}
		selected := in.SourceID == "" || a.ContextID == in.SourceID && in.SourceKind == "context"
		for _, ref := range k.Sources {
			if e := s.checkAutoSource(ctx, p, scope, ref.Kind, ref.ID); e != nil {
				return e
			}
			selected = selected || ref.Kind == in.SourceKind && ref.ID == in.SourceID
		}
		if !selected {
			return invalid("AI 提取未关联指定来源")
		}
		return nil
	default:
		return identity.Denied("一键 Context 操作不可修改其他模块")
	}
}
func (s *Service) AutoContext(ctx context.Context, p identity.Principal, in ContextAutoInput) (ContextAutoResult, error) {
	out := ContextAutoResult{Items: []workspace.ContextEntry{}, Errors: []string{}}
	if p.Kind != "session" {
		return out, identity.Denied("一键 AI 操作需要网页登录")
	}
	if in.Mode != "" && in.Mode != "extract" && in.Mode != "organize" {
		return out, invalid("AI 操作类型无效")
	}
	if (in.SourceKind == "") != (in.SourceID == "") || len(in.SourceID) > 160 || len(in.Project) > 160 || len(in.Domain) > 160 || len(in.Member) > 160 {
		return out, invalid("AI 操作范围无效")
	}
	if len(in.RequestID) == 0 || len(in.RequestID) > 100 {
		return out, invalid("请提供 request_id")
	}
	scope := &contextAutoScope{input: in, nodes: map[string]workspace.ContextNode{}}
	if in.SourceID != "" {
		project, domains, _, e := s.autoSource(ctx, p, in.SourceKind, in.SourceID)
		if e != nil {
			return out, e
		}
		if e = s.checkAutoSource(ctx, p, scope, in.SourceKind, in.SourceID); e != nil {
			return out, e
		}
		scope.input.Project = project
		if scope.input.Domain == "" && len(domains) == 1 {
			scope.input.Domain = domains[0]
		}
	}
	nodes, e := s.Workspace.ContextTree(ctx, p, workspace.ContextFilter{Project: scope.input.Project, Domain: scope.input.Domain, Member: scope.input.Member})
	if e != nil {
		return out, e
	}
	for _, n := range nodes {
		scope.nodes[n.ID] = n
	}
	template := Template{ID: "context-one-click", Scope: "builtin", Version: 1, Revision: 1, Title: "AI Context extraction", Instructions: "The user explicitly authorized one-click Context extraction and organization. Read the specified source and relevant existing knowledge, deduplicate and preserve human edits. Use propose_context to CREATE or UPDATE only relevant knowledge/documents/indexes; include real structured sources and fresh revisions. Prefer an existing main topic document and coherent directory. For a specified source, prepare one concise main-topic write; avoid repeating full originals in the body or source quotes. Otherwise prepare at most three concise useful writes, no filler. Batch independent read tools when possible, read only relevant originals, and leave room for a brief completion response within eight model rounds and twelve tool calls. Clearly separate established facts from open issues. This browser action automatically saves proposals and activates only records whose sources do not need review; do not ask the user to confirm routine Context writes. Never modify Todo/Timeline/Calendar, create schedules, invoke remote tools or archive conflicting material. If a real conflict or missing evidence prevents safe organization, explain it honestly and leave it for review." + contextWritingGuidance, Tools: []string{"read_workspace", "read_context_tree", "find_context", "read_context", "find_todos", "find_reports", "read_todo", "read_report", "read_calendar", "read_calendar_event", "propose_context"}}
	message := fmt.Sprintf("Organize Context automatically within project=%q domain=%q member=%q. Mode=%q. Selected source kind=%q id=%q. Read this source in full when specified, reuse existing topic documents, and save useful sourced knowledge. Report actual coverage and unresolved issues; do not claim unread material is organized.", scope.input.Project, scope.input.Domain, scope.input.Member, in.Mode, in.SourceKind, in.SourceID)
	turn, e := s.Chat(ctx, p, ChatInput{ConfigID: in.ConfigID, RequestID: in.RequestID, Message: message, Locale: in.Locale, Context: PageContext{Page: "/context", Project: scope.input.Project, Domain: scope.input.Domain, Member: scope.input.Member}, PinnedTemplate: &template, ContextAuto: scope})
	if e != nil {
		return out, e
	}
	out.ConversationID = turn.ConversationID
	out.Reply = turn.Turn.Reply
	for _, trace := range turn.Turn.Trace {
		if trace.State == "failed" {
			out.Errors = append(out.Errors, "部分 AI 操作未完成，请查看助手记录")
			break
		}
	}
	for _, draft := range turn.Turn.Actions {
		if draft.Kind != "propose_context" {
			continue
		}
		var proposed ToolArgs
		if json.Unmarshal(draft.Payload, &proposed) != nil || proposed.Knowledge == nil {
			out.Errors = append(out.Errors, "Context 草稿无效")
			continue
		}
		denied := false
		if proposed.ContextID != "" {
			if e := s.checkAutoSource(ctx, p, scope, "context", proposed.ContextID); e != nil {
				out.Errors = append(out.Errors, e.Error())
				denied = true
			}
		}
		for _, ref := range proposed.Knowledge.Sources {
			if e := s.checkAutoSource(ctx, p, scope, ref.Kind, ref.ID); e != nil {
				out.Errors = append(out.Errors, e.Error())
				denied = true
				break
			}
		}
		if denied {
			continue
		}
		done, e := s.Confirm(ctx, p, draft.ID, "confirm")
		if e != nil {
			out.Errors = append(out.Errors, e.Error())
			continue
		}
		if done.State != "done" {
			out.Errors = append(out.Errors, "部分 Context 未保存，请查看助手记录")
			continue
		}
		var receipt struct {
			ID       string `json:"id"`
			Revision int    `json:"revision"`
		}
		_ = json.Unmarshal(mustJSON(done.Result), &receipt)
		current, e := s.Workspace.GetContext(ctx, p, receipt.ID)
		if e != nil {
			out.Errors = append(out.Errors, e.Error())
			continue
		}
		if !current.NeedsReview {
			var args ToolArgs
			_ = json.Unmarshal(draft.Payload, &args)
			candidate := *args.Knowledge
			candidate.State = "active"
			candidate.SourceID = "assistant:" + draft.ID
			actor := p
			actor.SourceAgent = "CoFlow Assistant"
			active, e := s.Workspace.ChangeContext(ctx, actor, receipt.ID, workspace.ContextInput{ContextEntry: candidate, Action: "confirm", ExpectedRevision: receipt.Revision, OperationID: "auto-context:" + draft.ID})
			if e != nil {
				out.Errors = append(out.Errors, e.Error())
			} else {
				current = active
			}
		}
		out.Items = append(out.Items, current)
	}
	return out, nil
}
