package workspace

import (
	"context"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

type TodoScheduleChange struct {
	ID               string    `json:"id"`
	ExpectedRevision int       `json:"expected_revision"`
	Schedule         *Schedule `json:"schedule"`
}

func (c *TodoScheduleChange) UnmarshalJSON(data []byte) error {
	type fields TodoScheduleChange
	var input struct {
		fields
		Schedule json.RawMessage `json:"schedule"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return err
	}
	if input.Schedule == nil {
		return identity.Invalid("请填写 schedule；清除排期时使用 null")
	}
	*c = TodoScheduleChange(input.fields)
	return json.Unmarshal(input.Schedule, &c.Schedule)
}

type TodoScheduleBatch struct {
	OperationID string               `json:"operation_id"`
	Changes     []TodoScheduleChange `json:"changes"`
}

func (s *Service) ChangeTodoSchedules(ctx context.Context, p identity.Principal, in TodoScheduleBatch) ([]TodoScheduleResult, error) {
	if p.Kind != "session" {
		return nil, identity.Denied("批量改期需要网页登录确认")
	}
	if len(in.Changes) < 1 || len(in.Changes) > 25 {
		return nil, identity.Invalid("一次批量改期需包含 1–25 项任务")
	}
	seen := map[string]bool{}
	for _, change := range in.Changes {
		if change.ID == "" || seen[change.ID] || change.ExpectedRevision < 1 {
			return nil, identity.Invalid("请提供互不重复的任务 ID 和当前修订号")
		}
		seen[change.ID] = true
		if err := change.Schedule.Validate(false); err != nil {
			return nil, err
		}
	}
	input := struct {
		Kind  string
		Batch TodoScheduleBatch
	}{"schedule-batch", in}
	var out []TodoScheduleResult
	err := s.todoTransaction(ctx, p, func(tx pgx.Tx, b *TodoBoard) error {
		if retry, err := replayTodo(b, p, in.OperationID, input, &out); retry || err != nil {
			return err
		}
		for _, change := range in.Changes {
			task := b.task(change.ID)
			if task == nil || task.Archived {
				return store.ErrNotFound
			}
			if !todoWrite(p, *task) {
				return identity.Denied("无权修改其中一项任务的排期")
			}
			if task.Revision != change.ExpectedRevision {
				return todoConflict()
			}
			before := *task
			candidate := before
			candidate.Schedule = change.Schedule
			resetReview := false
			if before.Review != nil && reviewContentChanged(before, candidate) {
				if before.Review.State == "approved" {
					return identity.Invalid("请先重新打开已验收任务")
				}
				if before.Review.State == "pending" {
					candidate.Review = draftReview(before.Review)
					resetReview = true
				}
			}
			if err := validateTodo(ctx, tx, p, b, &candidate, &before); err != nil {
				return err
			}
			*task = candidate
			recordTodo(p, task, before, "edit")
			if resetReview {
				if err := todoNotify(ctx, tx, p, *task, []string{task.CreatorID, task.AssigneeID, before.Review.ReviewerID}, "todo-review"); err != nil {
					return err
				}
			}
			out = append(out, TodoScheduleResult{ID: task.ID, Title: task.Title, Revision: task.Revision, Schedule: task.Schedule, UpdatedAt: task.UpdatedAt})
		}
		saveTodoReplay(b, p, in.OperationID, input, out)
		return nil
	})
	return out, err
}

type TodoScheduleResult struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Revision  int       `json:"revision"`
	Schedule  *Schedule `json:"schedule"`
	UpdatedAt time.Time `json:"updated_at"`
}
