package workspace

import (
	"context"
	"errors"
	"time"

	"coflow/api/internal/db"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

// EditReport preserves source attribution and serializes browser edits with Agent updates.
func (s *Service) EditReport(ctx context.Context, p identity.Principal, id string, input store.Report, expected time.Time) (store.Report, error) {
	var out store.Report
	if p.Kind != "session" {
		return out, identity.Denied("编辑简报需要网页登录")
	}
	err := s.transaction(ctx, p, func(tx pgx.Tx) error {
		var locked string
		if err := tx.QueryRow(ctx, `SELECT id FROM reports WHERE team_id=$1 AND id=$2 FOR UPDATE`, p.TeamID, id).Scan(&locked); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return store.ErrNotFound
			}
			return err
		}
		row, err := db.New(tx).GetReport(ctx, db.GetReportParams{ID: id, TeamID: p.TeamID})
		if err != nil {
			return err
		}
		before := store.FromDB(row)
		if before.AuthorID != p.UserID && p.Role != "admin" {
			return store.ErrForbidden
		}
		if expected.IsZero() || !before.UpdatedAt.Equal(expected) {
			return &identity.Error{Status: 409, Message: "简报已有新进展，请重新打开后编辑"}
		}
		out = before
		out.Title = input.Title
		out.Body = input.Body
		out.Status = input.Status
		out.Links = input.Links
		out.Mentions = input.Mentions
		// Resolve manually changed classification, then protect it from later Agent guesses.
		if input.ProjectID != before.ProjectID || input.ProjectName != "" || !equalJSON(input.Domains, before.Domains) {
			out.ProjectID = input.ProjectID
			out.ProjectName = input.ProjectName
			out.Domain = ""
			out.Domains = input.Domains
			if err = resolveReport(ctx, tx, p, &out); err != nil {
				return err
			}
			out.ClassificationLocked = true
		}
		out.UpdatedAt = time.Now().UTC()
		out, err = store.SaveWith(ctx, db.New(tx), out)
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, p, before, out, "编辑简报"); err != nil {
			return err
		}
		return notify(ctx, tx, p, append(append([]string{}, out.Mentions...), out.AuthorID), out.ID, "", "report", "简报已更新："+out.Title)
	})
	return out, err
}
