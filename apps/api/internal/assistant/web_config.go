package assistant

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type WebConfig struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Scope      string     `json:"scope"`
	Provider   string     `json:"provider"`
	Revision   int        `json:"revision"`
	Default    bool       `json:"is_default"`
	VerifiedAt *time.Time `json:"verified_at"`
	Editable   bool       `json:"editable"`
	secret     []byte
	owner      *string
	team       *string
}
type WebConfigInput struct {
	WebConfig
	APIKey            string `json:"api_key"`
	ExpectedRevision  int    `json:"expected_revision"`
	VerificationToken string `json:"verification_token"`
}

const webConfigCols = `id,name,provider,revision,is_default,verified_at,secret,team_id,owner_id`

func scanWebConfig(row pgx.Row, p identity.Principal) (WebConfig, error) {
	var c WebConfig
	e := row.Scan(&c.ID, &c.Name, &c.Provider, &c.Revision, &c.Default, &c.VerifiedAt, &c.secret, &c.team, &c.owner)
	c.Scope = "team"
	if c.owner != nil {
		c.Scope = "personal"
	}
	c.Editable = c.owner != nil || admin(p)
	return c, e
}
func (s *Service) WebConfigs(ctx context.Context, p identity.Principal) ([]WebConfig, error) {
	rows, e := s.Pool.Query(ctx, `SELECT `+webConfigCols+` FROM assistant_web_configs WHERE (team_id=$1 AND owner_id IS NULL) OR (team_id IS NULL AND owner_id=$2) ORDER BY is_default DESC,created_at,id`, p.TeamID, p.UserID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []WebConfig{}
	for rows.Next() {
		c, e := scanWebConfig(rows, p)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Service) webConfig(ctx context.Context, p identity.Principal, id string) (WebConfig, error) {
	c, e := scanWebConfig(s.Pool.QueryRow(ctx, `SELECT `+webConfigCols+` FROM assistant_web_configs WHERE id=$1 AND ((team_id=$2 AND owner_id IS NULL) OR (team_id IS NULL AND owner_id=$3))`, id, p.TeamID, p.UserID), p)
	if errors.Is(e, pgx.ErrNoRows) {
		return c, &identity.Error{Status: 404, Message: "联网配置不可用"}
	}
	return c, e
}
func (s *Service) webKey(c WebConfig, p identity.Principal) (string, error) {
	team := p.TeamID
	if c.owner != nil {
		team = ""
	}
	return s.open(Config{ID: "web:" + c.ID, secret: c.secret, owner: c.owner, keyTeam: &team}, p.TeamID)
}
func webProofInput(in WebConfigInput) ConfigInput {
	return ConfigInput{Config: Config{Scope: in.Scope, Provider: in.Provider, Protocol: "web-tools", BaseURL: webBase(in.Provider), Model: "search-fetch"}, ExpectedRevision: in.ExpectedRevision}
}
func (s *Service) prepareWebConfig(ctx context.Context, p identity.Principal, id string, in WebConfigInput) (WebConfigInput, WebConfig, string, error) {
	old := WebConfig{}
	if p.Kind != "session" {
		return in, old, "", identity.Denied("仅网页登录可管理 AI 配置")
	}
	if in.Scope != "personal" && in.Scope != "team" {
		return in, old, "", invalid("请选择配置来源")
	}
	if in.Scope == "team" && !admin(p) {
		return in, old, "", identity.Denied("只有管理员可管理团队 AI 配置")
	}
	if _, e := s.aead(); e != nil {
		return in, old, "", e
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 100 || webBase(in.Provider) == "" {
		return in, old, "", invalid("请填写名称并选择联网服务商")
	}
	if id != "" {
		var e error
		old, e = s.webConfig(ctx, p, id)
		if e != nil {
			return in, old, "", e
		}
		if !old.Editable || old.Scope != in.Scope {
			return in, old, "", identity.Denied("无权编辑此 AI 配置")
		}
		if old.Revision != in.ExpectedRevision {
			return in, old, "", conflict()
		}
	}
	key := strings.TrimSpace(in.APIKey)
	if key == "" && old.ID != "" {
		if old.Provider != in.Provider {
			return in, old, "", invalid("服务商已更改，请重新填写 API Key")
		}
		var e error
		key, e = s.webKey(old, p)
		if e != nil {
			return in, old, "", e
		}
	}
	if key == "" || len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
		return in, old, "", invalid("请填写有效的 API Key")
	}
	return in, old, key, nil
}
func (s *Service) VerifyWebConfig(ctx context.Context, p identity.Principal, in WebConfigInput) (ConfigVerification, error) {
	in, _, key, e := s.prepareWebConfig(ctx, p, in.ID, in)
	if e != nil {
		return ConfigVerification{}, e
	}
	leave, e := s.enter()
	if e != nil {
		return ConfigVerification{}, e
	}
	defer leave()
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	w := newWebSession("https://example.com/")
	w.provider = in.Provider
	if _, e = s.webTool(ctx, w, "web_search", `{"query":"CoFlow documentation"}`, key); e != nil {
		return ConfigVerification{}, e
	}
	if _, e = s.webTool(ctx, w, "web_fetch", `{"url":"https://example.com/"}`, key); e != nil {
		return ConfigVerification{}, e
	}
	expiry := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	value := strconv.FormatInt(expiry.Unix(), 10) + "." + verificationFingerprint(p, "web:"+in.ID, webProofInput(in), key)
	return ConfigVerification{VerificationToken: value + "." + s.signVerification(value), ExpiresAt: expiry}, nil
}
func (s *Service) SaveWebConfig(ctx context.Context, p identity.Principal, id string, in WebConfigInput) (WebConfig, error) {
	in, old, key, e := s.prepareWebConfig(ctx, p, id, in)
	if e != nil {
		return old, e
	}
	verified := old.VerifiedAt
	if in.VerificationToken != "" {
		if !s.validVerification(p, "web:"+id, webProofInput(in), key, in.VerificationToken, time.Now()) {
			return old, invalid("验证已失效，请重新验证后保存")
		}
		now := time.Now()
		verified = &now
	} else {
		previous := ""
		if old.ID != "" {
			previous, e = s.webKey(old, p)
			if e != nil {
				return old, e
			}
		}
		if old.ID == "" || old.Provider != in.Provider || previous != key || verified == nil {
			return old, invalid("请先验证联网配置")
		}
	}
	if id == "" {
		id = store.ID()
	}
	var team, owner any
	keyTeam := p.TeamID
	who := ""
	lock := "team:" + p.TeamID
	if in.Scope == "personal" {
		owner = p.UserID
		who = p.UserID
		keyTeam = ""
		lock = "account:" + p.UserID
	} else {
		team = p.TeamID
	}
	secret, e := s.seal("web:"+id, keyTeam, who, key)
	if e != nil {
		return old, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return old, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "web-config:"+lock); e != nil {
		return old, e
	}
	if in.Default {
		if _, e = tx.Exec(ctx, `UPDATE assistant_web_configs SET is_default=false WHERE team_id IS NOT DISTINCT FROM $1::text AND owner_id IS NOT DISTINCT FROM $2::text`, team, owner); e != nil {
			return old, e
		}
	}
	if old.ID == "" {
		_, e = tx.Exec(ctx, `INSERT INTO assistant_web_configs(id,team_id,owner_id,name,provider,secret,is_default,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, team, owner, in.Name, in.Provider, secret, in.Default, verified)
	} else {
		tag, err := tx.Exec(ctx, `UPDATE assistant_web_configs SET name=$1,provider=$2,secret=$3,is_default=$4,verified_at=$5,revision=revision+1,updated_at=now() WHERE id=$6 AND revision=$7`, in.Name, in.Provider, secret, in.Default, verified, id, in.ExpectedRevision)
		e = err
		if e == nil && tag.RowsAffected() != 1 {
			return old, conflict()
		}
	}
	if e != nil {
		return old, e
	}
	if e = tx.Commit(ctx); e != nil {
		return old, e
	}
	return s.webConfig(ctx, p, id)
}
func (s *Service) DeleteWebConfig(ctx context.Context, p identity.Principal, id string, revision int) error {
	c, e := s.webConfig(ctx, p, id)
	if e != nil {
		return e
	}
	if !c.Editable {
		return identity.Denied("无权编辑此 AI 配置")
	}
	tag, e := s.Pool.Exec(ctx, `DELETE FROM assistant_web_configs WHERE id=$1 AND revision=$2 AND ((team_id=$3 AND owner_id IS NULL) OR (team_id IS NULL AND owner_id=$4))`, id, revision, p.TeamID, p.UserID)
	if e == nil && tag.RowsAffected() != 1 {
		return conflict()
	}
	return e
}
