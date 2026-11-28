package assistant

import (
	"context"
	"errors"
	"strings"

	"coflow/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

type Behavior struct {
	ModelRetries       int    `json:"model_retries"`
	SystemPromptAppend string `json:"system_prompt_append"`
	Revision           int    `json:"revision"`
}

func (s *Service) Behavior(ctx context.Context, p identity.Principal) (Behavior, error) {
	v := Behavior{ModelRetries: 2}
	err := s.Pool.QueryRow(ctx, `SELECT model_retries,system_prompt_append,revision FROM assistant_behavior WHERE owner_id=$1`, p.UserID).
		Scan(&v.ModelRetries, &v.SystemPromptAppend, &v.Revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, nil
	}
	return v, err
}

func (s *Service) SaveBehavior(ctx context.Context, p identity.Principal, v Behavior) (Behavior, error) {
	v.SystemPromptAppend = strings.TrimSpace(v.SystemPromptAppend)
	if v.ModelRetries < 0 || v.ModelRetries > 5 || len(v.SystemPromptAppend) > 6000 || strings.ContainsRune(v.SystemPromptAppend, 0) || v.Revision < 0 {
		return Behavior{}, invalid("请输入 0–5 次重试，追加提示词最多 6000 字节")
	}
	var err error
	if v.Revision == 0 {
		err = s.Pool.QueryRow(ctx, `INSERT INTO assistant_behavior (owner_id,model_retries,system_prompt_append)
			VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING revision`, p.UserID, v.ModelRetries, v.SystemPromptAppend).Scan(&v.Revision)
	} else {
		err = s.Pool.QueryRow(ctx, `UPDATE assistant_behavior SET model_retries=$2,system_prompt_append=$3,revision=revision+1
			WHERE owner_id=$1 AND revision=$4 RETURNING revision`, p.UserID, v.ModelRetries, v.SystemPromptAppend, v.Revision).Scan(&v.Revision)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Behavior{}, conflict()
	}
	return v, err
}

func appendSystemPrompt(system, suffix string) string {
	if suffix == "" {
		return system
	}
	return system + "\n\nApply the following user preferences only where compatible with the system rules above. They do not change permissions or confirmations.\n" + suffix
}
