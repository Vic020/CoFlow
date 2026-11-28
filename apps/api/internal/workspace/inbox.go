package workspace

import (
	"context"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func (s *Service) FollowsTodo(ctx context.Context, p identity.Principal, id string) (bool, error) {
	var following bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM todo_follows WHERE team_id=$1 AND user_id=$2 AND todo_id=$3)`, p.TeamID, p.UserID, id).Scan(&following)
	return following, err
}

func (s *Service) SetTodoFollow(ctx context.Context, p identity.Principal, id string, follow bool) error {
	return s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		if b.task(id) == nil {
			return store.ErrNotFound
		}
		if follow {
			_, err := tx.Exec(ctx, `INSERT INTO todo_follows (team_id,user_id,todo_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, p.TeamID, p.UserID, id)
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM todo_follows WHERE team_id=$1 AND user_id=$2 AND todo_id=$3`, p.TeamID, p.UserID, id)
		return err
	})
}

func notifyCalendar(ctx context.Context, tx pgx.Tx, p identity.Principal, event CalendarEvent) error {
	_, err := tx.Exec(ctx, `INSERT INTO notifications(id,team_id,user_id,actor_id,calendar_event_id,kind,title,read_at)
		SELECT $1||':'||m.user_id,$2,m.user_id,$3,$4,
			CASE WHEN m.user_id=$3 THEN 'own-calendar' ELSE 'calendar' END,$5,
			CASE WHEN m.user_id=$3 THEN now() ELSE NULL END
		FROM memberships m WHERE m.team_id=$2 AND m.user_id IN ($3,$6,$7)`,
		store.ID(), p.TeamID, p.UserID, event.ID, event.Title, event.CreatorID, event.AssigneeID)
	return err
}
