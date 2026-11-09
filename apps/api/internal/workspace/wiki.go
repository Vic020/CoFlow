package workspace

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"time"
)

// ContextNode is a permission-filtered directory entry, never a content snapshot.
type ContextNode struct {
	ReferenceIDs []string  `json:"reference_ids"`
	ID           string    `json:"id"`
	ParentID     string    `json:"parent_id"`
	Title        string    `json:"title"`
	Kind         string    `json:"kind"`
	State        string    `json:"state"`
	Visibility   string    `json:"visibility"`
	ProjectID    string    `json:"project_id"`
	Domains      []string  `json:"domains"`
	CreatorID    string    `json:"creator_id"`
	Revision     int       `json:"revision"`
	NeedsReview  bool      `json:"needs_review"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (s *Service) ContextTree(ctx context.Context, p identity.Principal, f ContextFilter) ([]ContextNode, error) {
	xs, e := s.contextEntries(ctx, p, f)
	if e != nil {
		return nil, e
	}
	visible := map[string]bool{}
	for _, x := range xs {
		visible[x.ID] = true
	}
	out := []ContextNode{}
	for _, x := range xs {
		parent := x.ParentID
		if !visible[parent] {
			parent = ""
		}
		refs := []string{}
		for _, ref := range x.Sources {
			if ref.Kind == "context" {
				refs = append(refs, ref.ID)
			}
		}
		out = append(out, ContextNode{ID: x.ID, ParentID: parent, Title: x.Title, Kind: x.Kind, State: x.State, Visibility: x.Visibility, ProjectID: x.ProjectID, Domains: x.Domains, CreatorID: x.CreatorID, Revision: x.Revision, NeedsReview: x.NeedsReview, UpdatedAt: x.UpdatedAt, ReferenceIDs: refs})
	}
	return out, nil
}

// Follow current reference permissions, bounded independently of graph validity.
func (s *Service) contextReference(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, id string, path map[string]bool) (*ContextEntry, error) {
	budget := 128
	x, _, e := s.contextReferenceStatus(ctx, tx, p, b, id, path, &budget)
	return x, e
}
func (s *Service) contextReferenceStatus(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, id string, path map[string]bool, budget *int) (*ContextEntry, bool, error) {
	*budget--
	x := b.knowledge(id)
	if x == nil || !contextVisible(p, *x) || path[id] || len(path) >= 12 || *budget < 0 {
		return nil, false, store.ErrNotFound
	}
	path[id] = true
	defer delete(path, id)
	stale := contextState(*x) != "active" || x.ValidFrom != "" && x.ValidFrom > time.Now().UTC().Format("2006-01-02") || x.ReviewOn != "" && x.ReviewOn <= time.Now().UTC().Format("2006-01-02")
	for _, v := range x.Sources {
		if v.Kind == "context" {
			target, changed, e := s.contextReferenceStatus(ctx, tx, p, b, v.ID, path, budget)
			if e != nil {
				return nil, false, e
			}
			stale = stale || changed || v.Revision != "" && v.Revision != contextReferenceVersion(target)
		} else {
			actual, e := s.contextSource(ctx, tx, p, b, v)
			if e != nil {
				return nil, false, e
			}
			stale = stale || actual.Changed || actual.Archived || actual.NeedsReview
		}
	}
	return x, stale, nil
}
func (s *Service) validateWiki(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, x ContextEntry) error {
	if x.ParentID != "" {
		parent, e := s.contextReference(ctx, tx, p, b, x.ParentID, map[string]bool{})
		if e != nil {
			return e
		}
		if parent.State == "archived" || parent.Kind != "document" && parent.Kind != "index" || parent.ProjectID != x.ProjectID || parent.Visibility != x.Visibility || x.Visibility == "personal" && parent.CreatorID != x.CreatorID {
			return identity.Invalid("目录与文档范围不一致")
		}
		seen := map[string]bool{x.ID: true}
		node := parent
		for node != nil {
			if seen[node.ID] || len(seen) >= 12 {
				return identity.Invalid("目录不可循环或超过 12 层")
			}
			seen[node.ID] = true
			if node.ParentID == "" {
				break
			}
			node = b.knowledge(node.ParentID)
		}
	}
	budget := 128
	var visit func(string, map[string]bool) error
	visit = func(id string, path map[string]bool) error {
		budget--
		if path[id] || len(path) >= 12 || budget < 0 {
			return identity.Invalid("Context 引用不可循环或超过 12 层")
		}
		path[id] = true
		defer delete(path, id)
		v := b.knowledge(id)
		if id == x.ID {
			v = &x
		}
		if v == nil {
			return store.ErrNotFound
		}
		for _, ref := range v.Sources {
			if ref.Kind == "context" {
				if err := visit(ref.ID, path); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, ref := range x.Sources {
		if ref.Kind == "context" {
			target, e := s.contextReference(ctx, tx, p, b, ref.ID, map[string]bool{})
			if e != nil {
				return e
			}
			if x.Visibility == "team" && target.Visibility != "team" {
				return identity.Invalid("团队文档不可引用个人 Context")
			}
		}
	}
	return visit(x.ID, map[string]bool{})
}
func (s *Service) contextParent(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	_, e := s.contextReference(ctx, tx, p, b, id, map[string]bool{})
	if errors.Is(e, store.ErrNotFound) {
		return "", nil
	}
	return id, e
}
func contextReferenceVersion(x *ContextEntry) string { return fmt.Sprint(x.Revision) }
