package workspace

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"errors"
	"testing"
)

func TestWikiHierarchyAndTransitiveSourcePrivacy(t *testing.T) {
	s := &Service{TodoDemo: &TodoMemory{}}
	p := identity.Principal{Kind: "demo", UserID: "chen", TeamID: "demo"}
	guest := identity.Principal{Kind: "demo", UserID: "lin", TeamID: "demo"}
	create := func(title, kind, parent string, sources []ContextSource) ContextEntry {
		t.Helper()
		v, e := s.ChangeContext(t.Context(), p, "", ContextInput{ContextEntry: ContextEntry{Title: title, Body: "# Synthetic facts", Kind: kind, Visibility: "team", State: "active", SourceID: store.ID(), ParentID: parent, Sources: sources}, OperationID: store.ID()})
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	root := create("Project introduction", "document", "", nil)
	child := create("Delivery guide", "document", root.ID, nil)
	fact := create("Evidence", "decision", root.ID, nil)
	draft := root
	draft.ParentID = child.ID
	if _, e := s.ChangeContext(t.Context(), p, root.ID, ContextInput{ContextEntry: draft, ExpectedRevision: root.Revision, OperationID: store.ID()}); e == nil {
		t.Fatal("directory cycle accepted")
	}
	root, _ = s.GetContext(t.Context(), p, root.ID)
	tree, e := s.ContextTree(t.Context(), guest, ContextFilter{})
	if e != nil || len(tree) != 3 {
		t.Fatal(tree, e)
	}
	found := false
	for _, n := range tree {
		if n.ID == child.ID {
			found = n.ParentID == root.ID
		}
	}
	if !found {
		t.Fatal("child directory lost")
	}
	synthesis := create("Compiled guide", "document", "", []ContextSource{{Kind: "context", ID: fact.ID, Quote: "Evidence"}})
	fact.Body = "Updated source facts"
	fact, e = s.ChangeContext(t.Context(), p, fact.ID, ContextInput{ContextEntry: fact, ExpectedRevision: fact.Revision, OperationID: store.ID()})
	if e != nil {
		t.Fatal(e)
	}
	derived, e := s.GetContext(t.Context(), guest, synthesis.ID)
	if e != nil || !derived.NeedsReview || !derived.Sources[0].Changed {
		t.Fatal(derived, e)
	}
	cyc := fact
	cyc.Sources = []ContextSource{{Kind: "context", ID: synthesis.ID}}
	if _, e := s.ChangeContext(t.Context(), p, fact.ID, ContextInput{ContextEntry: cyc, ExpectedRevision: fact.Revision, OperationID: store.ID()}); e == nil {
		t.Fatal("citation cycle accepted")
	}
	fact.Visibility = "personal"
	if _, e := s.ChangeContext(t.Context(), p, fact.ID, ContextInput{ContextEntry: fact, ExpectedRevision: fact.Revision, OperationID: store.ID()}); e == nil {
		t.Fatal("private child under shared directory accepted")
	}
	fact.ParentID = ""
	if _, e := s.ChangeContext(t.Context(), p, fact.ID, ContextInput{ContextEntry: fact, ExpectedRevision: fact.Revision, OperationID: store.ID()}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.GetContext(t.Context(), guest, synthesis.ID); !errors.Is(e, store.ErrNotFound) {
		t.Fatal("private source leaked:", e)
	}
	tree, e = s.ContextTree(t.Context(), guest, ContextFilter{})
	if e != nil {
		t.Fatal(e)
	}
	for _, n := range tree {
		if n.ID == fact.ID || n.ID == synthesis.ID {
			t.Fatal("directory leaked private derived title")
		}
	}
}

func TestWikiFutureSourceIsNotAnEstablishedFact(t *testing.T) {
	s := &Service{TodoDemo: &TodoMemory{}}
	p := identity.Principal{Kind: "demo", UserID: "chen", TeamID: "demo"}
	source, e := s.ChangeContext(t.Context(), p, "", ContextInput{ContextEntry: ContextEntry{Title: "Future rule", Body: "Not applicable yet", Kind: "rule", State: "active", Visibility: "team", ValidFrom: "2099-01-01", SourceID: "future-rule"}, OperationID: "future-rule"})
	if e != nil {
		t.Fatal(e)
	}
	article, e := s.ChangeContext(t.Context(), p, "", ContextInput{ContextEntry: ContextEntry{Title: "Future-derived article", Body: "Not established yet", Kind: "document", State: "active", Visibility: "team", SourceID: "future-article", Sources: []ContextSource{{Kind: "context", ID: source.ID}}}, OperationID: "future-article"})
	if e != nil || !article.NeedsReview || !article.Sources[0].NeedsReview || article.Sources[0].Archived {
		t.Fatal(article, e)
	}
}
