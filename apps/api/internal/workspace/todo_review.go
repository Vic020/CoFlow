package workspace

import (
	"context"
	"reflect"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type TodoReview struct {
	SubmittedRevision int        `json:"submitted_revision,omitempty"`
	Criteria          string     `json:"criteria"`
	ReviewerID        string     `json:"reviewer_id"`
	State             string     `json:"state"`
	Evidence          string     `json:"evidence,omitempty"`
	SubmittedBy       string     `json:"submitted_by,omitempty"`
	SubmittedAt       *time.Time `json:"submitted_at,omitempty"`
	DecisionBy        string     `json:"decision_by,omitempty"`
	DecidedAt         *time.Time `json:"decided_at,omitempty"`
	DecisionNote      string     `json:"decision_note,omitempty"`
}

// Only configuration is accepted from clients. All progress/decision fields are server-owned.
func draftReview(v *TodoReview) *TodoReview {
	if v == nil {
		return nil
	}
	return &TodoReview{Criteria: strings.TrimSpace(v.Criteria), ReviewerID: strings.TrimSpace(v.ReviewerID), State: "draft"}
}
func sameReview(a, b *TodoReview) bool { return reflect.DeepEqual(a, b) }
func reviewAllowsCompletion(t Todo) error {
	if t.Review != nil && t.Review.State != "approved" {
		return identity.Invalid("此任务需要指定验收人通过后才能完成")
	}
	return nil
}
func validateReview(ctx context.Context, tx pgx.Tx, p identity.Principal, t Todo, old *Todo) error {
	if t.Review == nil {
		return nil
	}
	r := t.Review
	if strings.TrimSpace(r.Criteria) == "" || len(r.Criteria) > 8000 || r.ReviewerID == "" || len(r.ReviewerID) > 160 {
		return identity.Invalid("请填写验收标准并指定验收人")
	}
	if old == nil || old.Review == nil || old.Review.ReviewerID != r.ReviewerID {
		return currentReviewer(ctx, tx, p, r.ReviewerID)
	}
	return nil
}
func currentReviewer(ctx context.Context, tx pgx.Tx, p identity.Principal, id string) error {
	if tx == nil {
		for _, m := range store.Members {
			if m.ID == id {
				return nil
			}
		}
		return identity.Invalid("验收人不在当前团队")
	}
	var ok bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2)`, p.TeamID, id).Scan(&ok); e != nil {
		return e
	}
	if !ok {
		return identity.Invalid("验收人不在当前团队")
	}
	return nil
}
func reviewContentChanged(before, after Todo) bool {
	// Cosmetic/source changes and scheduling are still content changes for an explicit review.
	a, b := before, after
	a.History = nil
	b.History = nil
	a.Comments = nil
	b.Comments = nil
	a.Revision = 0
	b.Revision = 0
	a.UpdatedAt = time.Time{}
	b.UpdatedAt = time.Time{}
	return !reflect.DeepEqual(a, b)
}

func applyReview(ctx context.Context, tx pgx.Tx, p identity.Principal, b *TodoBoard, t *Todo, in TodoInput) error {
	if t.Archived || t.CompletedAt != nil {
		return identity.Invalid("请先恢复或重新打开任务")
	}
	if t.Review == nil {
		return identity.Invalid("请先配置验收标准和验收人")
	}
	r := *t.Review // Copy before mutation so before/after history remains independent.
	now := time.Now().UTC()
	note := strings.TrimSpace(in.Body)
	if len(note) > 12000 {
		return identity.Invalid("验收说明过长")
	}
	switch in.Action {
	case "submit-review":
		if r.State == "pending" {
			return identity.Invalid("任务已提交验收")
		}
		if note == "" {
			return identity.Invalid("请填写交付依据")
		}
		if e := currentReviewer(ctx, tx, p, r.ReviewerID); e != nil {
			return e
		}
		r.State = "pending"
		r.Evidence = note
		r.SubmittedRevision = t.Revision + 1
		r.SubmittedBy = p.UserID
		r.SubmittedAt = &now
		r.DecisionBy = ""
		r.DecidedAt = nil
		r.DecisionNote = ""
	case "withdraw-review":
		if r.State != "pending" {
			return identity.Invalid("任务未在验收中")
		}
		t.Review = draftReview(&r)
		return nil
	case "approve-review", "request-changes":
		if r.ReviewerID != p.UserID {
			return identity.Denied("只有指定验收人可以通过或退回")
		}
		if r.State != "pending" {
			return identity.Invalid("任务未在验收中")
		}
		if in.Action == "request-changes" && note == "" {
			return identity.Invalid("请填写退回原因")
		}
		r.DecisionBy = p.UserID
		r.DecidedAt = &now
		r.DecisionNote = note
		if in.Action == "approve-review" {
			if in.BoardRevision != b.Revision {
				return todoConflict()
			}
			r.State = "approved"
			t.Review = &r
			if e := todoMove(b, t, b.DefaultDoneID, "", ""); e != nil {
				return e
			}
			b.Revision++
		} else {
			r.State = "changes_requested"
		}
	default:
		return identity.Invalid("验收操作无效")
	}
	t.Review = &r
	return nil
}
