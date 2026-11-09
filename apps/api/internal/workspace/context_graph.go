package workspace

import (
	"coflow/api/internal/db"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/url"
	"sort"
	"strings"
)

type KnowledgeGraphNode struct {
	Key         string `json:"key"`
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	State       string `json:"state,omitempty"`
	NeedsReview bool   `json:"needs_review,omitempty"`
	Root        bool   `json:"root"`
}
type KnowledgeGraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}
type KnowledgeGraph struct {
	Nodes         []KnowledgeGraphNode `json:"nodes"`
	Edges         []KnowledgeGraphEdge `json:"edges"`
	TotalContexts int                  `json:"total_contexts"`
	ShownContexts int                  `json:"shown_contexts"`
	Truncated     bool                 `json:"truncated"`
}

func (s *Service) ContextGraph(ctx context.Context, p identity.Principal, f ContextFilter) (KnowledgeGraph, error) {
	out := KnowledgeGraph{Nodes: []KnowledgeGraphNode{}, Edges: []KnowledgeGraphEdge{}}
	if !p.Can("context:read") {
		return out, identity.Denied("需要 context:read 权限")
	}
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		roots := []ContextEntry{}
		for _, raw := range b.Contexts {
			if f.Project != "" && raw.ProjectID != f.Project || f.Domain != "" && !hasDomain(raw.Domains, f.Domain) || f.Member != "" && raw.CreatorID != f.Member || f.Kind != "" && raw.Kind != f.Kind {
				continue
			}
			x, e := s.safeContext(ctx, tx, p, b, raw, false)
			if errors.Is(e, store.ErrNotFound) {
				continue
			}
			if e != nil {
				return e
			}
			if f.State != "" && x.State != f.State || f.State == "" && x.State == "archived" || f.Q != "" && !strings.Contains(strings.ToLower(x.Title+" "+x.Body), strings.ToLower(f.Q)) {
				continue
			}
			match := f.Source == ""
			for _, ref := range x.Sources {
				match = match || ref.Kind == f.Source
			}
			if !match {
				continue
			}
			roots = append(roots, x)
		}
		sort.Slice(roots, func(i, j int) bool {
			if roots[i].UpdatedAt.Equal(roots[j].UpdatedAt) {
				return roots[i].ID < roots[j].ID
			}
			return roots[i].UpdatedAt.After(roots[j].UpdatedAt)
		})
		out.TotalContexts = len(roots)
		if len(roots) > 120 {
			roots = roots[:120]
			out.Truncated = true
		}
		out.ShownContexts = len(roots)
		nodes := map[string]int{}
		edges := map[[3]string]bool{}
		add := func(n KnowledgeGraphNode) bool {
			if i, ok := nodes[n.Key]; ok {
				out.Nodes[i].Root = out.Nodes[i].Root || n.Root
				return true
			}
			if len(out.Nodes) >= 600 {
				out.Truncated = true
				return false
			}
			nodes[n.Key] = len(out.Nodes)
			out.Nodes = append(out.Nodes, n)
			return true
		}
		edge := func(from, to, kind string) {
			if from == to {
				return
			}
			if _, ok := nodes[from]; !ok {
				return
			}
			if _, ok := nodes[to]; !ok {
				return
			}
			key := [3]string{from, to, kind}
			if edges[key] {
				return
			}
			if len(out.Edges) >= 2400 {
				out.Truncated = true
				return
			}
			edges[key] = true
			out.Edges = append(out.Edges, KnowledgeGraphEdge{from, to, kind})
		}
		projectNames := map[string]string{}
		if tx != nil {
			catalog, e := categories(ctx, tx, p.TeamID)
			if e != nil {
				return e
			}
			for _, c := range catalog {
				if c.Kind == "project" {
					projectNames[c.ID] = c.Name
				}
			}
		} else {
			for _, v := range store.Projects {
				projectNames[v.ID] = v.Name
			}
		}
		classify := func(key, project string, domains []string) {
			if project != "" {
				name := projectNames[project]
				if name == "" {
					name = project
				}
				k := "project:" + project
				add(KnowledgeGraphNode{Key: k, ID: project, Kind: "project", Title: name, URL: "/context?knowledge_view=graph&filters=1&project=" + url.QueryEscape(project)})
				edge(key, k, "project")
			}
			for _, d := range domains {
				if d == "" {
					continue
				}
				k := "domain:" + d
				add(KnowledgeGraphNode{Key: k, ID: d, Kind: "domain", Title: d, URL: "/context?knowledge_view=graph&filters=1&domain=" + url.QueryEscape(d)})
				edge(key, k, "domain")
			}
		}
		reports := map[string]store.Report{}
		getReport := func(id string) (store.Report, error) {
			if v, ok := reports[id]; ok {
				return v, nil
			}
			var v store.Report
			var e error
			if tx != nil {
				row, err := db.New(tx).GetReport(ctx, db.GetReportParams{TeamID: p.TeamID, ID: id})
				e = err
				if e == nil {
					v = store.FromDB(row)
				}
			} else if s.SourceReports != nil {
				v, e = s.SourceReports.Get(ctx, p.TeamID, id)
			} else {
				e = store.ErrNotFound
			}
			if errors.Is(e, pgx.ErrNoRows) {
				e = store.ErrNotFound
			}
			if e == nil && v.DeletedAt != nil {
				e = store.ErrNotFound
			}
			if e == nil {
				reports[id] = v
			}
			return v, e
		}
		var entity func(string, string) (string, error)
		entity = func(kind, id string) (string, error) {
			key := kind + ":" + id
			if _, ok := nodes[key]; ok {
				return key, nil
			}
			n := KnowledgeGraphNode{Key: key, ID: id, Kind: kind}
			project := ""
			domains := []string{}
			switch kind {
			case "context":
				x := b.knowledge(id)
				if x == nil {
					return "", nil
				}
				v, e := s.safeContext(ctx, tx, p, b, *x, false)
				if errors.Is(e, store.ErrNotFound) {
					return "", nil
				}
				if e != nil {
					return "", e
				}
				n.Title = v.Title
				n.State = v.State
				n.NeedsReview = v.NeedsReview
				n.URL = "/context?context=" + url.QueryEscape(id)
				project = v.ProjectID
				domains = v.Domains
			case "todo":
				if !p.Can("todos:read") {
					return "", nil
				}
				v := b.task(id)
				if v == nil {
					return "", nil
				}
				n.Title = v.Title
				n.URL = "/todo?todo=" + url.QueryEscape(id)
				if v.Archived {
					n.State = "archived"
				}
				project = v.ProjectID
				domains = v.Domains
			case "report":
				if !p.Can("reports:read") {
					return "", nil
				}
				v, e := getReport(id)
				if errors.Is(e, store.ErrNotFound) {
					return "", nil
				}
				if e != nil {
					return "", e
				}
				n.Title = v.Title
				n.State = v.Status
				n.URL = "/?report=" + url.QueryEscape(id)
				project = v.ProjectID
				domains = append(append([]string{}, v.Domains...), v.Domain)
			case "calendar":
				if !p.Can("calendar:read") {
					return "", nil
				}
				v, e := loadEvent(ctx, tx, b, p, id, "")
				if errors.Is(e, store.ErrNotFound) {
					return "", nil
				}
				if e != nil {
					return "", e
				}
				n.Title = v.Title
				n.URL = "/calendar?event=" + url.QueryEscape(id)
				if v.Archived {
					n.State = "archived"
				}
				project = v.ProjectID
				domains = v.Domains
			default:
				return "", nil
			}
			if !add(n) {
				return "", nil
			}
			classify(key, project, domains)
			return key, nil
		}
		for _, x := range roots {
			add(KnowledgeGraphNode{Key: "context:" + x.ID, ID: x.ID, Kind: "context", Title: x.Title, State: x.State, NeedsReview: x.NeedsReview, URL: "/context?context=" + url.QueryEscape(x.ID), Root: true})
		}
		for _, x := range roots {
			key := "context:" + x.ID
			classify(key, x.ProjectID, x.Domains)
			if x.ParentID != "" {
				parent, e := entity("context", x.ParentID)
				if e != nil {
					return e
				}
				edge(key, parent, "parent")
			}
			for _, ref := range x.Sources {
				k, e := entity(ref.Kind, ref.ID)
				if e != nil {
					return e
				}
				edge(key, k, "source")
			}
		}
		// Expand only explicit relations on directly linked business objects, not the whole workspace.
		base := append([]KnowledgeGraphNode{}, out.Nodes...)
		for _, n := range base {
			switch n.Kind {
			case "todo":
				v := b.task(n.ID)
				for _, id := range v.ReportIDs {
					k, e := entity("report", id)
					if e != nil {
						return e
					}
					edge(n.Key, k, "todo_report")
				}
			case "report":
				for _, t := range b.Tasks {
					for _, id := range t.ReportIDs {
						if id == n.ID {
							k, e := entity("todo", t.ID)
							if e != nil {
								return e
							}
							edge(k, n.Key, "todo_report")
						}
					}
				}
			case "calendar":
				v, e := loadEvent(ctx, tx, b, p, n.ID, "")
				if e != nil {
					return e
				}
				for _, id := range v.TodoIDs {
					k, e := entity("todo", id)
					if e != nil {
						return e
					}
					edge(n.Key, k, "calendar_todo")
				}
				for _, id := range v.ReportIDs {
					k, e := entity("report", id)
					if e != nil {
						return e
					}
					edge(n.Key, k, "calendar_report")
				}
			}
		}
		return nil
	})
	return out, err
}
func hasDomain(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
