package workspace

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"errors"
	"testing"
)

func TestReportSourceVersionsCompareInstants(t *testing.T) {
	a := sourceVersion("report", "2026-11-08T12:30:00.123456+08:00")
	b := sourceVersion("report", "2026-11-08T04:30:00.123456Z")
	if a != b {
		t.Fatalf("same instant differs: %s %s", a, b)
	}
	if sourceVersion("todo", "12") != "12" {
		t.Fatal("task revision changed")
	}
}

func TestDueContextReviewClearsOnlyDueDate(t *testing.T) {
	s := &Service{TodoDemo: &TodoMemory{}}
	p := identity.Principal{Kind: "demo", UserID: "chen", TeamID: "demo"}
	x, e := s.ChangeContext(t.Context(), p, "", ContextInput{ContextEntry: ContextEntry{Title: "Confirmed decision", Body: "Original facts retained", Kind: "decision", Visibility: "team", State: "active", SourceID: "due-review", ReviewOn: "2020-01-01"}, OperationID: "due-create"})
	if e != nil || !x.NeedsReview {
		t.Fatal(x, e)
	}
	y, e := s.ChangeContext(t.Context(), p, x.ID, ContextInput{ContextEntry: x, ExpectedRevision: x.Revision, OperationID: "due-review", Action: "review"})
	if e != nil || y.NeedsReview || y.ReviewOn != "" || y.Body != x.Body || y.State != "active" {
		t.Fatal(y, e)
	}
}

var errSourceUnavailable = errors.New("synthetic source transport unavailable")

type unavailableReports struct{ store.Repository }

func (unavailableReports) Get(context.Context, string, string) (store.Report, error) {
	return store.Report{}, errSourceUnavailable
}
func TestContextSourceFailureIsNotAnEmptyCollection(t *testing.T) {
	b := newTodoBoard()
	b.Contexts = []ContextEntry{{ID: "entry", CreatorID: "chen", Visibility: "team", Sources: []ContextSource{{Kind: "report", ID: "source"}}}}
	s := &Service{SourceReports: unavailableReports{}, TodoDemo: &TodoMemory{board: b}}
	p := identity.Principal{Kind: "demo", TeamID: "demo", UserID: "chen"}
	if _, _, e := s.Contexts(t.Context(), p, ContextFilter{}); !errors.Is(e, errSourceUnavailable) {
		t.Fatalf("source outage reported as absence: %v", e)
	}
	if _, e := s.GetContext(t.Context(), p, "entry"); !errors.Is(e, errSourceUnavailable) {
		t.Fatalf("source outage hidden: %v", e)
	}
}
