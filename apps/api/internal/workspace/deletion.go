package workspace

import (
	"coflow/api/internal/db"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

// Trash is session-only and reveals deleted content only to its author or a team administrator.
func (s *Service) Trash(ctx context.Context, p identity.Principal, report string) ([]json.RawMessage, error) {
	if p.Kind != "session" {
		return nil, identity.Denied("此操作需要网页登录")
	}
	query := `SELECT to_jsonb(r) FROM reports r WHERE team_id=$1 AND deleted_at IS NOT NULL AND (author_id=$2 OR $3='admin') ORDER BY deleted_at DESC,id`
	args := []any{p.TeamID, p.UserID, p.Role}
	if report != "" {
		query = `SELECT to_jsonb(c) FROM comments c JOIN reports r ON r.id=c.report_id WHERE r.team_id=$1 AND r.id=$4 AND r.deleted_at IS NULL AND c.deleted_at IS NOT NULL AND (c.author_id=$2 OR $3='admin') ORDER BY c.deleted_at DESC,c.id`
		args = append(args, report)
	}
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var v json.RawMessage
		if err = rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Service) DeleteOrRestore(ctx context.Context, p identity.Principal, report, comment string, restore bool, expected time.Time) error {
	if p.Kind != "session" {
		return identity.Denied("此操作需要网页登录")
	}
	return s.transaction(ctx, p, func(tx pgx.Tx) error {
		row, err := db.New(tx).GetReportIncludingDeleted(ctx, db.GetReportIncludingDeletedParams{ID: report, TeamID: p.TeamID})
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		before := store.FromDB(row)
		if comment == "" {
			if p.UserID != before.AuthorID && p.Role != "admin" {
				return store.ErrForbidden
			}
			if restore == (before.DeletedAt == nil) {
				return nil
			} // Repeated operations are idempotent.
			if !restore && (expected.IsZero() || !expected.Equal(before.UpdatedAt)) {
				return &identity.Error{Status: 409, Message: "简报已有新进展，请重新打开后编辑"}
			}
			if restore {
				_, err = tx.Exec(ctx, `UPDATE reports SET deleted_at=NULL,updated_at=now() WHERE id=$1`, report)
			} else {
				_, err = tx.Exec(ctx, `UPDATE reports SET deleted_at=now(),updated_at=now() WHERE id=$1`, report)
			}
			if err != nil {
				return err
			}
			afterRow, err := db.New(tx).GetReportIncludingDeleted(ctx, db.GetReportIncludingDeletedParams{ID: report, TeamID: p.TeamID})
			if err != nil {
				return err
			}
			action := "删除简报"
			if restore {
				action = "恢复简报"
			}
			return audit(ctx, tx, p, before, store.FromDB(afterRow), action)
		}
		if before.DeletedAt != nil {
			return store.ErrNotFound
		}
		var author string
		var deleted *time.Time
		err = tx.QueryRow(ctx, `SELECT author_id,deleted_at FROM comments WHERE id=$1 AND report_id=$2 FOR UPDATE`, comment, report).Scan(&author, &deleted)
		if errors.Is(err, pgx.ErrNoRows) {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		if p.UserID != author && p.Role != "admin" {
			return store.ErrForbidden
		}
		if restore == (deleted == nil) {
			return nil
		}
		if restore {
			_, err = tx.Exec(ctx, `UPDATE comments SET deleted_at=NULL WHERE id=$1`, comment)
		} else {
			_, err = tx.Exec(ctx, `UPDATE comments SET deleted_at=now() WHERE id=$1`, comment)
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE reports SET updated_at=now() WHERE id=$1`, report)
		if err != nil {
			return err
		}
		// Record the target without copying deleted comment content into visible history.
		action := "删除评论：" + comment
		if restore {
			action = "恢复评论：" + comment
		}
		return audit(ctx, tx, p, store.Report{ID: report}, store.Report{ID: report}, action)
	})
}
