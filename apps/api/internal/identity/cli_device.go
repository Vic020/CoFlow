package identity

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"coflow/api/internal/db"
	"github.com/jackc/pgx/v5"
)

const deviceTTL = 10 * time.Minute

type DeviceStart struct {
	DeviceCode string `json:"device_code"`
	UserCode   string `json:"user_code"`
	ExpiresIn  int    `json:"expires_in"`
	Interval   int    `json:"interval"`
}

type DeviceScope struct {
	ProjectID string `json:"project_id,omitempty"`
	TodoID    string `json:"todo_id,omitempty"`
}
type DeviceReview struct {
	DeviceScope
	Name   string   `json:"name"`
	Scopes []string `json:"scopes"`
	Days   int      `json:"days"`
	UserID string   `json:"user_id"`
	TeamID string   `json:"team_id"`
}

func (s *Service) StartDevice(ctx context.Context, name string, scopes []string, days int, team string, limit DeviceScope) (DeviceStart, error) {
	name, err := cleanName(name)
	if err != nil {
		return DeviceStart{}, err
	}
	if days < 1 || days > 30 {
		return DeviceStart{}, Invalid("CLI 授权有效期需为 1–30 天")
	}
	scopes, err = validateTokenScopes(scopes)
	if err != nil {
		return DeviceStart{}, err
	}
	if len(team) > 160 || len(limit.ProjectID) > 160 || len(limit.TodoID) > 160 || (limit.ProjectID != "" && limit.TodoID != "") {
		return DeviceStart{}, Invalid("请选择一个项目或任务")
	}
	if limit.ProjectID != "" || limit.TodoID != "" {
		for _, scope := range scopes {
			if scope != "todos:read" && scope != "todos:write" {
				return DeviceStart{}, Invalid("限定项目或任务的授权仅支持 Todo 权限")
			}
		}
	}
	device := secret("cd_")
	const alphabet = "BCDFGHJKMNPQRTVWXY23"
	code := make([]byte, 8)
	for i := range code {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return DeviceStart{}, err
		}
		code[i] = alphabet[index.Int64()]
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return DeviceStart{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "DELETE FROM cli_device_requests WHERE expires_at <= now()"); err != nil {
		return DeviceStart{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO cli_device_requests
		(device_hash,user_code_hash,name,scopes,days,expires_at,expected_team_id,project_id,todo_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, Hash(device), Hash(string(code)), name, scopes, days, time.Now().Add(deviceTTL), team, limit.ProjectID, limit.TodoID)
	if err != nil {
		return DeviceStart{}, err
	}
	return DeviceStart{device, string(code[:4]) + "-" + string(code[4:]), int(deviceTTL.Seconds()), 5}, tx.Commit(ctx)
}

func deviceUserHash(code string) string {
	return Hash(strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(code)), "-", ""))
}

func (s *Service) ReviewDevice(ctx context.Context, p Principal, code string) (DeviceReview, error) {
	out := DeviceReview{UserID: p.UserID, TeamID: p.TeamID}
	err := s.Pool.QueryRow(ctx, `SELECT name,scopes,days,project_id,todo_id FROM cli_device_requests
		WHERE user_code_hash=$1 AND state='pending' AND expires_at>now() AND expected_team_id IN ('',$2)`, deviceUserHash(code), p.TeamID).Scan(&out.Name, &out.Scopes, &out.Days, &out.ProjectID, &out.TodoID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, notFound("配对码无效或已过期")
	}
	return out, err
}

func (s *Service) DecideDevice(ctx context.Context, p Principal, code, userID, teamID string, approve bool) error {
	if p.UserID != userID || p.TeamID != teamID {
		return conflict("账号或空间已切换，请重新查看授权")
	}
	state := "denied"
	if approve {
		state = "approved"
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE cli_device_requests SET state=$2,user_id=$3,team_id=$4
		WHERE user_code_hash=$1 AND state='pending' AND expires_at>now() AND expected_team_id IN ('',$4)`, deviceUserHash(code), state, userID, teamID)
	if err == nil && tag.RowsAffected() == 0 {
		return notFound("配对码无效或已过期")
	}
	return err
}

// RedeemDevice serializes polling and token issuance. An approved code is consumed in the token transaction.
func (s *Service) RedeemDevice(ctx context.Context, device string) (map[string]any, string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback(ctx)
	hash := Hash(device)
	var name, state, project, todo string
	var teamID, userID *string
	var scopes []string
	var days, interval int
	var early bool
	err = tx.QueryRow(ctx, `SELECT name,state,team_id,user_id,scopes,days,poll_interval,next_poll_at>clock_timestamp(),project_id,todo_id
		FROM cli_device_requests WHERE device_hash=$1 AND expires_at>clock_timestamp() FOR UPDATE`, hash).
		Scan(&name, &state, &teamID, &userID, &scopes, &days, &interval, &early, &project, &todo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "expired_token", nil
	}
	if err != nil {
		return nil, "", err
	}
	if state == "denied" {
		return nil, "access_denied", nil
	}
	if early || state == "pending" {
		result := "authorization_pending"
		if early {
			interval += 5
			result = "slow_down"
		}
		_, err = tx.Exec(ctx, `UPDATE cli_device_requests SET poll_interval=$2,
			next_poll_at=clock_timestamp()+($2::integer * interval '1 second') WHERE device_hash=$1`, hash, interval)
		if err != nil {
			return nil, "", err
		}
		return nil, result, tx.Commit(ctx)
	}
	if teamID == nil || userID == nil {
		return nil, "access_denied", nil
	}
	out, err := s.issueToken(ctx, s.Q.WithTx(tx), Principal{UserID: *userID, TeamID: *teamID}, name, scopes, stamp(time.Now().Add(time.Duration(days)*24*time.Hour)), "cf_cli_")
	if err != nil {
		return nil, "", err
	}
	token := out["token"].(db.CreateAgentTokenRow)
	if _, err = tx.Exec(ctx, "UPDATE agent_tokens SET cli_project_id=$2,cli_todo_id=$3 WHERE id=$1", token.ID, project, todo); err != nil {
		return nil, "", err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM cli_device_requests WHERE device_hash=$1", hash); err != nil {
		return nil, "", err
	}
	return map[string]any{"access_token": out["credential"], "token_type": "Bearer", "expires_in": days * 86400,
		"scope": strings.Join(scopes, " "), "user_id": *userID, "team_id": *teamID,
		"grant_id": token.ID, "project_id": project, "todo_id": todo}, "", tx.Commit(ctx)
}

func (s *Service) RevokeDeviceToken(ctx context.Context, p Principal, raw string) error {
	if p.Kind != "token" || !strings.HasPrefix(raw, "cf_cli_") {
		return Denied("仅允许撤销当前 CLI 授权")
	}
	_, err := s.Pool.Exec(ctx, `UPDATE agent_tokens SET revoked_at=now()
		WHERE token_hash=$1 AND team_id=$2 AND user_id=$3 AND revoked_at IS NULL`, Hash(raw), p.TeamID, p.UserID)
	return err
}
