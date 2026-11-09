package assistant

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/workspace"
	"strings"
	"testing"
)

func TestContextInitializationRequiresProjectAndCannotAdvanceWork(t *testing.T) {
	var init Template
	for _, v := range builtins() {
		if v.ID == "builtin-context-init" {
			init = v
		}
	}
	if init.ID == "" {
		t.Fatal("initialization template missing")
	}
	if _, err := renderTemplate(init, nil); err == nil {
		t.Fatal("unbounded initialization accepted")
	}
	if text, err := renderTemplate(init, map[string]string{"project": "Synthetic project"}); err != nil || !strings.Contains(text, "Synthetic project") {
		t.Fatal(text, err)
	}
	for _, name := range init.Tools {
		if strings.HasPrefix(name, "propose_") && name != "propose_context" {
			t.Fatal("initialization can mutate unrelated module:", name)
		}
	}
}

func TestContextSearchPendingIsExplicitAndNotEstablishedKnowledge(t *testing.T) {
	s := &Service{Workspace: &workspace.Service{TodoDemo: &workspace.TodoMemory{}}}
	p := identity.Principal{Kind: "demo", UserID: "chen", TeamID: "demo"}
	for _, state := range []string{"active", "pending"} {
		_, err := s.Workspace.ChangeContext(t.Context(), p, "", workspace.ContextInput{ContextEntry: workspace.ContextEntry{Title: state, Body: "Synthetic fact", Kind: "decision", Visibility: "team", State: state, SourceID: state}, OperationID: state})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, state := range []string{"", "pending"} {
		result, _, _, err := s.tool(t.Context(), p, "find_context", ToolArgs{ContextState: state})
		if err != nil {
			t.Fatal(err)
		}
		entries := result.(map[string]any)["items"].([]workspace.ContextEntry)
		expected := state
		if expected == "" {
			expected = "active"
		}
		if len(entries) != 1 || entries[0].State != expected {
			t.Fatalf("state %q returned %#v", state, entries)
		}
	}
	if _, _, _, err := s.tool(t.Context(), p, "find_context", ToolArgs{ContextState: "all"}); err == nil {
		t.Fatal("unsupported lifecycle scope accepted")
	}
}

func TestWikiDirectoryAndBodyPagination(t *testing.T) {
	s := &Service{Workspace: &workspace.Service{TodoDemo: &workspace.TodoMemory{}}}
	p := identity.Principal{Kind: "demo", UserID: "chen", TeamID: "demo"}
	text := strings.Repeat("知识🦀", 2000)
	v, err := s.Workspace.ChangeContext(t.Context(), p, "", workspace.ContextInput{ContextEntry: workspace.ContextEntry{Title: "Long document", Body: text, Kind: "document", Visibility: "team", State: "active", SourceID: "wiki-long"}, OperationID: "wiki-long"})
	if err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	offset := 0
	for {
		result, _, _, e := s.tool(t.Context(), p, "read_context", ToolArgs{ContextID: v.ID, Offset: offset})
		if e != nil {
			t.Fatal(e)
		}
		page := result.(map[string]any)
		got.WriteString(page["entry"].(workspace.ContextEntry).Body)
		if !page["has_more"].(bool) {
			break
		}
		offset = page["next_offset"].(int)
	}
	if got.String() != text {
		t.Fatal("document pagination lost Unicode content")
	}
	result, _, _, e := s.tool(t.Context(), p, "read_context_tree", ToolArgs{})
	if e != nil {
		t.Fatal(e)
	}
	page := result.(map[string]any)
	if page["content_included"] != false || len(page["items"].([]workspace.ContextNode)) != 1 {
		t.Fatal(page)
	}
	for _, template := range builtins() {
		if template.ID == "builtin-wiki" {
			for _, name := range template.Tools {
				if strings.HasPrefix(name, "propose_") && name != "propose_context" {
					t.Fatal("Wiki template can mutate unrelated objects")
				}
			}
			return
		}
	}
	t.Fatal("Wiki template missing")
}

func TestOneClickScopeCannotBroadenWritesAndDoesNotChooseAmbiguousTitles(t *testing.T) {
	s := &Service{}
	p := identity.Principal{Kind: "session", UserID: "synthetic-owner", TeamID: "synthetic-team"}
	scope := &contextAutoScope{input: ContextAutoInput{Project: "project-a"}, nodes: map[string]workspace.ContextNode{}}
	if e := s.guardAutoTool(t.Context(), p, scope, "propose_todo", &ToolArgs{}); e == nil {
		t.Fatal("one-click Context grant allowed task write")
	}
	if e := s.guardAutoTool(t.Context(), p, scope, "propose_context", &ToolArgs{Knowledge: &workspace.ContextEntry{ProjectID: "project-b"}}); e == nil {
		t.Fatal("model broadened project scope")
	}
	scope.nodes["a"] = workspace.ContextNode{ID: "a", Title: "Working agreement", ProjectID: "project-a", Visibility: "team", CreatorID: p.UserID}
	scope.nodes["b"] = workspace.ContextNode{ID: "b", Title: "Working agreement", ProjectID: "project-a", Visibility: "team", CreatorID: p.UserID}
	args := ToolArgs{Knowledge: &workspace.ContextEntry{ProjectID: "project-a", Visibility: "team", Title: "Working agreement"}}
	if e := s.guardAutoTool(t.Context(), p, scope, "propose_context", &args); e == nil {
		t.Fatal("automatic title reuse arbitrarily chose between duplicate documents")
	}
}
