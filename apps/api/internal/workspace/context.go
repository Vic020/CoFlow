package workspace

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"regexp"
	"sort"
	"strings"
	"time"
)

type ContextSource struct {
	NeedsReview bool   `json:"needs_review"`
	Kind        string `json:"kind"`
	ID          string `json:"id"`
	Revision    string `json:"revision"`
	Quote       string `json:"quote"`
	URL         string `json:"url"`
	Changed     bool   `json:"changed"`
	Archived    bool   `json:"archived"`
}
type ContextRevision struct {
	ParentID     string          `json:"parent_id"`
	SupersededBy string          `json:"superseded_by"`
	ProjectID    string          `json:"project_id"`
	Domains      []string        `json:"domains"`
	Kind         string          `json:"kind"`
	ValidFrom    string          `json:"valid_from"`
	ValidUntil   string          `json:"valid_until"`
	State        string          `json:"state"`
	ReviewOn     string          `json:"review_on"`
	Agent        string          `json:"agent"`
	Visibility   string          `json:"visibility"`
	Revision     int             `json:"revision"`
	ActorID      string          `json:"actor_id"`
	ActorKind    string          `json:"actor_kind"`
	Action       string          `json:"action"`
	At           time.Time       `json:"at"`
	Title        string          `json:"title"`
	Body         string          `json:"body"`
	Sources      []ContextSource `json:"sources"`
	Unavailable  bool            `json:"unavailable"`
}
type ContextEntry struct {
	ParentID     string            `json:"parent_id"`
	Agent        string            `json:"agent"`
	ID           string            `json:"id"`
	SourceID     string            `json:"source_id"`
	CreatorID    string            `json:"creator_id"`
	Title        string            `json:"title"`
	Body         string            `json:"body"`
	Kind         string            `json:"kind"`
	Visibility   string            `json:"visibility"`
	ProjectID    string            `json:"project_id"`
	Domains      []string          `json:"domains"`
	State        string            `json:"state"`
	ValidFrom    string            `json:"valid_from"`
	ValidUntil   string            `json:"valid_until"`
	ReviewOn     string            `json:"review_on"`
	SupersededBy string            `json:"superseded_by"`
	Sources      []ContextSource   `json:"sources"`
	Revision     int               `json:"revision"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
	NeedsReview  bool              `json:"needs_review"`
	History      []ContextRevision `json:"history"`
}
type ContextInput struct {
	ContextEntry
	ExpectedRevision int    `json:"expected_revision"`
	TargetRevision   int    `json:"target_revision"`
	OperationID      string `json:"operation_id"`
	Action           string `json:"action"`
}
type ContextFilter struct {
	Q, Project, Domain, Member, State, Kind, Source string
	Offset, Limit                                   int
}

func (b *TodoBoard) knowledge(id string) *ContextEntry {
	for i := range b.Contexts {
		if b.Contexts[i].ID == id {
			return &b.Contexts[i]
		}
	}
	return nil
}
func contextConflict() error {
	return &identity.Error{Status: 409, Message: "Context 或来源已更新，请重新读取"}
}
func sourceVersion(kind, revision string) string {
	if kind == "report" {
		if t, e := time.Parse(time.RFC3339Nano, revision); e == nil {
			return t.UTC().Format(time.RFC3339Nano)
		}
	}
	return revision
}
func contextVisible(p identity.Principal, x ContextEntry) bool {
	return x.Visibility == "team" || x.CreatorID == p.UserID
}
func contextWritable(p identity.Principal, x ContextEntry) bool {
	return x.CreatorID == p.UserID || x.Visibility == "team" && todoAdmin(p)
}

var contextSecret = regexp.MustCompile(`(?i)(cf_[a-z0-9_-]{20,}|sk-[a-z0-9_-]{20,}|github_pat_[a-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[a-z0-9_.-]{20,})`)

func contextDates(x *ContextEntry) error {
	for _, d := range []string{x.ValidFrom, x.ValidUntil, x.ReviewOn} {
		if d != "" {
			if _, e := time.Parse("2006-01-02", d); e != nil {
				return identity.Invalid("日期须为 YYYY-MM-DD")
			}
		}
	}
	if x.ValidFrom != "" && x.ValidUntil != "" && x.ValidFrom > x.ValidUntil {
		return identity.Invalid("有效日期范围无效")
	}
	return nil
}
func contextState(x ContextEntry) string {
	if x.State == "active" && x.ValidUntil != "" && x.ValidUntil < time.Now().UTC().Format("2006-01-02") {
		return "expired"
	}
	return x.State
}
func (s *Service) contextSource(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, v ContextSource) (ContextSource, error) {
	if len(v.Quote) > 2000 {
		return v, identity.Invalid("来源摘录过长")
	}
	rev := ""
	archived := false
	path := ""
	switch v.Kind {
	case "context":
		budget := 128
		x, stale, e := s.contextReferenceStatus(ctx, tx, p, b, v.ID, map[string]bool{}, &budget)
		if e != nil {
			return v, e
		}
		rev = contextReferenceVersion(x)
		archived = x.State == "archived"
		v.NeedsReview = stale
		path = "/context?context="
	case "todo":
		if !p.Can("todos:read") {
			return v, store.ErrNotFound
		}
		x := b.task(v.ID)
		if x == nil {
			return v, store.ErrNotFound
		}
		rev = fmt.Sprint(x.Revision)
		archived = x.Archived
		path = "/todo?todo="
	case "calendar":
		if !p.Can("calendar:read") {
			return v, store.ErrNotFound
		}
		x, e := loadEvent(ctx, tx, b, p, v.ID, "")
		if e != nil {
			return v, e
		}
		rev = fmt.Sprint(x.Revision)
		archived = x.Archived
		path = "/calendar?event="
	case "report":
		if !p.Can("reports:read") {
			return v, store.ErrNotFound
		}
		var updated time.Time
		if tx == nil {
			if s.SourceReports == nil {
				return v, store.ErrNotFound
			}
			x, e := s.SourceReports.Get(ctx, p.TeamID, v.ID)
			if e != nil {
				return v, e
			}
			if x.DeletedAt != nil {
				return v, store.ErrNotFound
			}
			updated = x.UpdatedAt
		} else if e := tx.QueryRow(ctx, `SELECT updated_at FROM reports WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL`, p.TeamID, v.ID).Scan(&updated); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return v, store.ErrNotFound
			}
			return v, e
		}
		rev = updated.UTC().Format(time.RFC3339Nano)
		path = "/?report="
	default:
		return v, identity.Invalid("来源类型无效")
	}
	v.Revision = sourceVersion(v.Kind, v.Revision)
	v.Changed = v.Revision != "" && v.Revision != rev
	v.Archived = archived
	if v.Revision == "" {
		v.Revision = rev
	}
	v.URL = path + v.ID
	return v, nil
}
func (s *Service) safeContext(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, x ContextEntry, history bool) (ContextEntry, error) {
	if !contextVisible(p, x) {
		return x, store.ErrNotFound
	}
	var parentErr error
	x.ParentID, parentErr = s.contextParent(ctx, tx, p, b, x.ParentID)
	if parentErr != nil {
		return x, parentErr
	}
	x.Domains = append([]string{}, x.Domains...)
	x.State = contextState(x)
	x.NeedsReview = x.ReviewOn != "" && x.ReviewOn <= time.Now().UTC().Format("2006-01-02")
	x.Sources = append([]ContextSource{}, x.Sources...)
	for i, v := range x.Sources {
		a, e := s.contextSource(ctx, tx, p, b, v)
		if e != nil {
			return x, e
		}
		x.Sources[i] = a
		x.NeedsReview = x.NeedsReview || a.Changed || a.Archived || a.NeedsReview
	}
	if !history {
		x.History = nil
		return x, nil
	}
	x.History = append([]ContextRevision{}, x.History...)
	for i := range x.History {
		h := &x.History[i]
		if h.Visibility != "team" && x.CreatorID != p.UserID {
			hideContextHistory(h)
			continue
		}
		var parentErr error
		h.ParentID, parentErr = s.contextParent(ctx, tx, p, b, h.ParentID)
		if parentErr != nil {
			return x, parentErr
		}
		h.Sources = append([]ContextSource{}, h.Sources...)
		for j, v := range h.Sources {
			a, e := s.contextSource(ctx, tx, p, b, v)
			if e != nil {
				if !errors.Is(e, store.ErrNotFound) {
					return x, e
				}
				hideContextHistory(h)
				break
			}
			h.Sources[j] = a
		}
	}
	return x, nil
}
func (s *Service) contextEntries(ctx context.Context, p identity.Principal, f ContextFilter) ([]ContextEntry, error) {
	out := []ContextEntry{}
	if !p.Can("context:read") {
		return out, identity.Denied("需要 context:read 权限")
	}
	e := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		for _, raw := range b.Contexts {
			if f.Project != "" && raw.ProjectID != f.Project || f.Domain != "" && !stringIn(raw.Domains, f.Domain) || f.Member != "" && raw.CreatorID != f.Member || f.Kind != "" && raw.Kind != f.Kind {
				continue
			}
			x, e := s.safeContext(ctx, tx, p, b, raw, false)
			if e != nil {
				if errors.Is(e, store.ErrNotFound) {
					continue
				}
				return e
			}
			if f.State != "" && x.State != f.State || f.Q != "" && !strings.Contains(strings.ToLower(x.Title+" "+x.Body), strings.ToLower(f.Q)) {
				continue
			}
			if f.Source != "" {
				match := false
				for _, v := range x.Sources {
					match = match || v.Kind == f.Source
				}
				if !match {
					continue
				}
			}
			out = append(out, x)
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, e
}
func (s *Service) Contexts(ctx context.Context, p identity.Principal, f ContextFilter) ([]ContextEntry, int, error) {
	if f.Offset < 0 {
		return nil, 0, identity.Invalid("offset invalid")
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 40
	}
	out, e := s.contextEntries(ctx, p, f)
	total := len(out)
	start := f.Offset
	if start > total {
		start = total
	}
	end := start + f.Limit
	if end > total {
		end = total
	}
	return out[start:end], total, e
}
func (s *Service) GetContext(ctx context.Context, p identity.Principal, id string) (ContextEntry, error) {
	var out ContextEntry
	if !p.Can("context:read") {
		return out, identity.Denied("需要 context:read 权限")
	}
	e := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		x := b.knowledge(id)
		if x == nil {
			return store.ErrNotFound
		}
		var e error
		out, e = s.safeContext(ctx, tx, p, b, *x, true)
		return e
	})
	return out, e
}
func sameExtraction(x ContextEntry, in ContextEntry) bool {
	if x.ParentID != in.ParentID || x.Title != strings.TrimSpace(in.Title) || x.Body != strings.TrimSpace(in.Body) || x.Kind != in.Kind || x.Visibility != in.Visibility || x.ProjectID != in.ProjectID || !equalJSON(append([]string{}, x.Domains...), append([]string{}, in.Domains...)) || x.ValidFrom != in.ValidFrom || x.ValidUntil != in.ValidUntil || x.ReviewOn != in.ReviewOn || len(x.Sources) != len(in.Sources) {
		return false
	}
	sourceKey := func(xs []ContextSource) string {
		keys := []string{}
		for _, v := range xs {
			raw, _ := json.Marshal([]string{v.Kind, v.ID, v.Quote})
			keys = append(keys, string(raw))
		}
		sort.Strings(keys)
		return strings.Join(keys, "|")
	}
	return sourceKey(x.Sources) == sourceKey(in.Sources)
}
func hideContextHistory(h *ContextRevision) {
	*h = ContextRevision{Revision: h.Revision, ActorID: h.ActorID, ActorKind: h.ActorKind, Agent: h.Agent, Action: h.Action, At: h.At, Unavailable: true}
}
func contextAgent(p identity.Principal) string {
	if p.SourceAgent != "" {
		return p.SourceAgent
	}
	if p.Kind == "token" {
		return "External Agent"
	}
	return ""
}
func contextHistory(p identity.Principal, x *ContextEntry, action string) {
	x.Revision++
	x.UpdatedAt = time.Now().UTC()
	x.History = append(x.History, ContextRevision{ParentID: x.ParentID, SupersededBy: x.SupersededBy, ProjectID: x.ProjectID, Domains: append([]string{}, x.Domains...), Kind: x.Kind, ValidFrom: x.ValidFrom, ValidUntil: x.ValidUntil, State: x.State, ReviewOn: x.ReviewOn, Agent: contextAgent(p), Visibility: x.Visibility, Revision: x.Revision, ActorID: p.UserID, ActorKind: p.Kind, Action: action, At: x.UpdatedAt, Title: x.Title, Body: x.Body, Sources: append([]ContextSource{}, x.Sources...)})
}
func (s *Service) ChangeContext(ctx context.Context, p identity.Principal, id string, in ContextInput) (ContextEntry, error) {
	var out ContextEntry
	if !p.Can("context:read") || !p.Can("context:write") {
		return out, identity.Denied("需要 context:read / context:write 权限")
	}
	e := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		input := struct {
			ID    string
			Input ContextInput
		}{id, in}
		// Cached writes must still respect current source permissions and private visibility.
		if replay, e := replayTodo(b, p, in.OperationID, input, &out); e != nil {
			return e
		} else if replay {
			current := b.knowledge(out.ID)
			if current == nil {
				return store.ErrNotFound
			}
			out, e = s.safeContext(ctx, tx, p, b, *current, true)
			return e
		}
		var x *ContextEntry
		if id != "" {
			x = b.knowledge(id)
			if x == nil || !contextVisible(p, *x) {
				return store.ErrNotFound
			}
			if !contextWritable(p, *x) {
				return identity.Denied("无权维护此 Context")
			}
			if x.Revision != in.ExpectedRevision {
				return contextConflict()
			}
		} else {
			if in.Action != "" && in.Action != "edit" {
				return identity.Invalid("先创建 Context 再操作")
			}
			if len(in.SourceID) == 0 || len(in.SourceID) > 160 {
				return identity.Invalid("请提供稳定 source_id")
			}
			for _, v := range b.Contexts {
				if v.CreatorID == p.UserID && v.SourceID == in.SourceID {
					if !sameExtraction(v, in.ContextEntry) {
						return contextConflict()
					}
					var e error
					out, e = s.safeContext(ctx, tx, p, b, v, true)
					if e != nil {
						return e
					}
					saveTodoReplay(b, p, in.OperationID, input, out)
					return nil
				}
			}
			if len(b.Contexts) >= 1000 {
				return identity.Invalid("当前团队 Context 已达 1000 条，请先整理")
			}
			b.Contexts = append(b.Contexts, ContextEntry{Agent: contextAgent(p), ID: store.ID(), CreatorID: p.UserID, SourceID: in.SourceID, CreatedAt: time.Now().UTC()})
			x = &b.Contexts[len(b.Contexts)-1]
		}
		switch in.Action {
		case "archive":
			x.State = "archived"
		case "restore":
			x.State = "pending"
			x.SupersededBy = ""
		case "merge":
			target := b.knowledge(in.SupersededBy)
			if target == nil || target.ID == x.ID || target.State == "archived" || target.SupersededBy != "" || !contextWritable(p, *target) || !contextVisible(p, *target) || target.Revision != in.TargetRevision || target.Visibility != x.Visibility || target.CreatorID != x.CreatorID && x.Visibility == "personal" {
				return identity.Invalid("合并目标或修订无效")
			}
			if _, e := s.safeContext(ctx, tx, p, b, *x, false); e != nil {
				return e
			}
			if _, e := s.safeContext(ctx, tx, p, b, *target, false); e != nil {
				return e
			}
			for _, v := range x.Sources {
				found := false
				for _, a := range target.Sources {
					found = found || a.Kind == v.Kind && a.ID == v.ID
				}
				if !found {
					target.Sources = append(target.Sources, v)
				}
			}
			if len(target.Sources) > 20 {
				return identity.Invalid("合并后来源超过 20 项")
			}
			if e := s.validateWiki(ctx, tx, p, b, *target); e != nil {
				return e
			}
			contextHistory(p, target, "merge-sources")
			x.State = "archived"
			x.SupersededBy = target.ID
		case "", "edit", "confirm", "review":
			candidate := in.ContextEntry
			candidate.Agent = x.Agent
			candidate.ID = x.ID
			candidate.CreatorID = x.CreatorID
			candidate.SourceID = x.SourceID
			candidate.Revision = x.Revision
			candidate.CreatedAt = x.CreatedAt
			candidate.History = x.History
			candidate.SupersededBy = x.SupersededBy
			if in.Action == "review" && candidate.ReviewOn != "" && candidate.ReviewOn <= time.Now().UTC().Format("2006-01-02") {
				candidate.ReviewOn = ""
			}
			candidate.Title = strings.TrimSpace(candidate.Title)
			candidate.Body = strings.TrimSpace(candidate.Body)
			if candidate.Title == "" || candidate.Body == "" || len(candidate.Title) > 500 || len(candidate.Body) > 20000 || len(candidate.Sources) > 20 || len(candidate.Domains) > 20 {
				return identity.Invalid("标题、内容或来源数量无效")
			}
			if contextSecret.MatchString(candidate.Title + candidate.Body) {
				return identity.Invalid("Context 不可保存凭证或密钥")
			}
			if !stringIn([]string{"background", "decision", "rule", "conclusion", "risk", "date", "document", "index"}, candidate.Kind) || !stringIn([]string{"team", "personal"}, candidate.Visibility) || !stringIn([]string{"pending", "active", "expired", "archived"}, candidate.State) {
				return identity.Invalid("类型、可见范围或状态无效")
			}
			if p.Kind == "token" && candidate.State == "active" {
				return identity.Denied("Agent 提取须待确认，由网页登录确认有效")
			}
			if e := contextDates(&candidate); e != nil {
				return e
			}
			if tx != nil {
				list, e := categories(ctx, tx, p.TeamID)
				if e != nil {
					return e
				}
				if candidate.ProjectID != "" {
					v, ok := find(list, "project", candidate.ProjectID, "")
					if !ok || v.State != "active" {
						return identity.Invalid("项目不可用")
					}
				}
				for _, d := range candidate.Domains {
					v, ok := find(list, "domain", "", d)
					if !ok || v.State != "active" {
						return identity.Invalid("领域不可用")
					}
				}
			}
			sources := []ContextSource{}
			seen := map[string]bool{}
			for _, v := range candidate.Sources {
				key := v.Kind + ":" + v.ID
				if seen[key] || contextSecret.MatchString(v.Quote) {
					return identity.Invalid("来源重复或包含凭证")
				}
				seen[key] = true
				// The reference version is always checked by Go, never trusted from the client.
				actual, e := s.contextSource(ctx, tx, p, b, ContextSource{Kind: v.Kind, ID: v.ID, Quote: v.Quote})
				if e != nil {
					return e
				}
				if v.Revision != "" && sourceVersion(v.Kind, v.Revision) != actual.Revision {
					return contextConflict()
				}
				sources = append(sources, actual)
			}
			candidate.Sources = sources
			if e := s.validateWiki(ctx, tx, p, b, candidate); e != nil {
				return e
			}
			*x = candidate
		default:
			return identity.Invalid("Context 操作无效")
		}
		contextHistory(p, x, in.Action)
		var e error
		out, e = s.safeContext(ctx, tx, p, b, *x, true)
		if e != nil {
			return e
		}
		saveTodoReplay(b, p, in.OperationID, input, out)
		return nil
	})
	return out, e
}
