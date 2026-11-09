package workspace

import (
	"coflow/api/internal/identity"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestContextGraphIsBoundedAndDoesNotExposePrivateDerivedNodes(t *testing.T) {
	b := newTodoBoard()
	for i := 0; i < 125; i++ {
		b.Contexts = append(b.Contexts, ContextEntry{ID: fmt.Sprintf("graph-%03d", i), CreatorID: "chen", Title: fmt.Sprintf("Knowledge %d", i), Body: "Never expose this source body", Kind: "rule", Visibility: "team", State: "active", ProjectID: "synthetic-project", Domains: []string{"Delivery"}})
	}
	b.Contexts = append(b.Contexts, ContextEntry{ID: "private", CreatorID: "chen", Title: "PRIVATE GRAPH TITLE", Body: "Private", Kind: "rule", Visibility: "personal", State: "active"}, ContextEntry{ID: "derived", CreatorID: "chen", Title: "PRIVATE DERIVED TITLE", Body: "Summary", Kind: "document", Visibility: "team", State: "active", Sources: []ContextSource{{Kind: "context", ID: "private"}}})
	s := &Service{TodoDemo: &TodoMemory{board: b}}
	p := identity.Principal{Kind: "token", UserID: "other", TeamID: "demo", Scopes: []string{"context:read"}}
	g, e := s.ContextGraph(t.Context(), p, ContextFilter{})
	if e != nil {
		t.Fatal(e)
	}
	if !g.Truncated || g.TotalContexts != 125 || g.ShownContexts != 120 {
		t.Fatal(g)
	}
	raw, _ := json.Marshal(g)
	if strings.Contains(string(raw), "Never expose") || strings.Contains(string(raw), "PRIVATE") {
		t.Fatal("graph leaks bodies or private derived metadata")
	}
	nodes := map[string]bool{}
	for _, n := range g.Nodes {
		nodes[n.Key] = true
	}
	for _, edge := range g.Edges {
		if !nodes[edge.From] || !nodes[edge.To] {
			t.Fatal("dangling edge")
		}
	}
	empty, e := s.ContextGraph(t.Context(), p, ContextFilter{Project: "another-project"})
	if e != nil || len(empty.Nodes) != 0 {
		t.Fatal(empty, e)
	}
	_, e = s.ContextGraph(t.Context(), identity.Principal{Kind: "token", Scopes: []string{"todos:read"}}, ContextFilter{})
	if e == nil {
		t.Fatal("missing knowledge scope allowed")
	}
}
func TestContextGraphSourceFailureIsNotAnEmptySuccess(t *testing.T) {
	b := newTodoBoard()
	b.Contexts = []ContextEntry{{ID: "source-fault", CreatorID: "chen", Title: "Source-backed knowledge", Visibility: "team", Sources: []ContextSource{{Kind: "report", ID: "report"}}}}
	s := &Service{TodoDemo: &TodoMemory{board: b}, SourceReports: unavailableReports{}}
	_, e := s.ContextGraph(t.Context(), identity.Principal{Kind: "demo", UserID: "chen", TeamID: "demo"}, ContextFilter{})
	if !errors.Is(e, errSourceUnavailable) {
		t.Fatal(e)
	}
}
