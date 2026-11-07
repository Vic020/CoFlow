package assistant

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	Slots     chan struct{}
	Identity  *identity.Service
	Pool      *pgxpool.Pool
	Workspace *workspace.Service
	Repo      store.Repository
	Key       string
	Client    *http.Client
}
type Config struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Scope      string     `json:"scope"`
	Provider   string     `json:"provider"`
	Protocol   string     `json:"protocol"`
	BaseURL    string     `json:"base_url"`
	Model      string     `json:"model"`
	Revision   int        `json:"revision"`
	Default    bool       `json:"is_default"`
	VerifiedAt *time.Time `json:"verified_at"`
	Editable   bool       `json:"editable"`
	secret     []byte
	owner      *string
}
type ConfigInput struct {
	Config
	APIKey            string `json:"api_key"`
	ExpectedRevision  int    `json:"expected_revision"`
	VerificationToken string `json:"verification_token"`
}

func invalid(s string) error { return identity.Invalid(s) }
func conflict() error {
	return &identity.Error{Status: 409, Message: "配置或会话已变化，请刷新后重试"}
}
func unavailable() error {
	return &identity.Error{Status: 503, Message: "请先在服务器配置 COFLOW_AI_ENCRYPTION_KEY"}
}
func (s *Service) aead() (cipher.AEAD, error) {
	key, e := base64.StdEncoding.DecodeString(s.Key)
	if e != nil || len(key) != 32 {
		return nil, unavailable()
	}
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(b)
}
func (s *Service) seal(id, team, owner, key string) ([]byte, error) {
	a, e := s.aead()
	if e != nil {
		return nil, e
	}
	n := make([]byte, a.NonceSize())
	if _, e = rand.Read(n); e != nil {
		return nil, e
	}
	return a.Seal(n, n, []byte(key), []byte(id+":"+team+":"+owner)), nil
}
func (s *Service) open(c Config, team string) (string, error) {
	a, e := s.aead()
	if e != nil {
		return "", e
	}
	if len(c.secret) < a.NonceSize() {
		return "", unavailable()
	}
	owner := ""
	if c.owner != nil {
		owner = *c.owner
	}
	v, e := a.Open(nil, c.secret[:a.NonceSize()], c.secret[a.NonceSize():], []byte(c.ID+":"+team+":"+owner))
	if e != nil {
		return "", unavailable()
	}
	return string(v), nil
}
func admin(p identity.Principal) bool { return p.Kind == "session" && p.Role == "admin" }
func publicIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "64:ff9b::/96", "64:ff9b:1::/48", "2002::/16"} {
		if inCIDR(ip, cidr) {
			return false
		}
	}
	return true
}
func inCIDR(ip net.IP, c string) bool { _, n, _ := net.ParseCIDR(c); return n.Contains(ip) }
func endpoint(raw string) (string, error) {
	u, e := url.Parse(strings.TrimSpace(raw))
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
		return "", invalid("AI 服务地址必须是公开 HTTPS 地址")
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") {
		return "", invalid("AI 服务地址必须是公开 HTTPS 地址")
	}
	if ip := net.ParseIP(h); ip != nil && !publicIP(ip) {
		return "", invalid("AI 服务地址必须是公开 HTTPS 地址")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

// Resolve and pin a public IP at dial time. No redirects, env proxies or DNS rebinding into internal services.
func secureClient() *http.Client {
	return &http.Client{Timeout: 22 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }, Transport: &http.Transport{TLSHandshakeTimeout: 8 * time.Second, ResponseHeaderTimeout: 20 * time.Second, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(addr)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
		if e != nil || len(ips) == 0 {
			return nil, errors.New("AI DNS lookup failed")
		}
		for _, ip := range ips {
			if !publicIP(ip.IP) {
				return nil, errors.New("private AI endpoint refused")
			}
		}
		return (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}}}
}
func (s *Service) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return secureClient()
}

const configCols = `id,name,provider,protocol,base_url,model,revision,is_default,verified_at,secret,owner_id`

func scanConfig(row pgx.Row, p identity.Principal) (Config, error) {
	var c Config
	e := row.Scan(&c.ID, &c.Name, &c.Provider, &c.Protocol, &c.BaseURL, &c.Model, &c.Revision, &c.Default, &c.VerifiedAt, &c.secret, &c.owner)
	c.Scope = "team"
	if c.owner != nil {
		c.Scope = "personal"
	}
	c.Editable = c.owner != nil || admin(p)
	return c, e
}
func (s *Service) Configs(ctx context.Context, p identity.Principal) ([]Config, error) {
	rows, e := s.Pool.Query(ctx, `SELECT `+configCols+` FROM assistant_configs WHERE team_id=$1 AND (owner_id IS NULL OR owner_id=$2) ORDER BY is_default DESC,created_at`, p.TeamID, p.UserID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Config{}
	for rows.Next() {
		c, e := scanConfig(rows, p)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Service) config(ctx context.Context, p identity.Principal, id string) (Config, error) {
	c, e := scanConfig(s.Pool.QueryRow(ctx, `SELECT `+configCols+` FROM assistant_configs WHERE id=$1 AND team_id=$2 AND (owner_id IS NULL OR owner_id=$3)`, id, p.TeamID, p.UserID), p)
	if errors.Is(e, pgx.ErrNoRows) {
		return c, &identity.Error{Status: 404, Message: "AI 配置不可用"}
	}
	return c, e
}
func (s *Service) prepareConfig(ctx context.Context, p identity.Principal, id string, in ConfigInput) (ConfigInput, Config, string, error) {
	if in.Scope != "team" && in.Scope != "personal" {
		return in, Config{}, "", invalid("请选择配置来源")
	}
	if in.Scope == "team" && !admin(p) {
		return in, Config{}, "", identity.Denied("只有管理员可管理团队 AI 配置")
	}
	if _, e := s.aead(); e != nil {
		return in, Config{}, "", e
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Model = strings.TrimSpace(in.Model)
	if in.Name == "" || len(in.Name) > 100 || in.Model == "" || len(in.Model) > 150 || strings.ContainsAny(in.Model, "\r\n") {
		return in, Config{}, "", invalid("请填写配置名称和模型")
	}
	if in.Provider != "deepseek" && in.Provider != "glm" && in.Provider != "openai" && in.Provider != "compatible" {
		return in, Config{}, "", invalid("服务商尚未适配")
	}
	if in.Protocol != "chat-completions" && in.Protocol != "responses" {
		return in, Config{}, "", invalid("协议尚未适配")
	}
	if in.Provider == "openai" && in.Protocol != "responses" || (in.Provider == "deepseek" || in.Provider == "glm") && in.Protocol != "chat-completions" {
		return in, Config{}, "", invalid("请选择服务商对应的协议")
	}
	var e error
	in.BaseURL, e = endpoint(in.BaseURL)
	if e != nil {
		return in, Config{}, "", e
	}
	old := Config{}
	if id != "" {
		old, e = s.config(ctx, p, id)
		if e != nil {
			return in, old, "", e
		}
		if !old.Editable || old.Scope != in.Scope {
			return in, old, "", identity.Denied("不能修改此 AI 配置")
		}
		if old.Revision != in.ExpectedRevision {
			return in, old, "", conflict()
		}
	}
	key := strings.TrimSpace(in.APIKey)
	if key == "" && old.ID != "" {
		if in.BaseURL != old.BaseURL || in.Provider != old.Provider {
			return in, old, "", invalid("服务商或地址已更改，请重新填写 API Key")
		}
		key, e = s.open(old, p.TeamID)
		if e != nil {
			return in, old, "", e
		}
	}
	if key == "" || len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
		return in, old, "", invalid("请填写有效的 API Key")
	}

	return in, old, key, nil
}
func (s *Service) SaveConfig(ctx context.Context, p identity.Principal, id string, in ConfigInput) (Config, error) {

	in, old, key, e := s.prepareConfig(ctx, p, id, in)
	if e != nil {
		return Config{}, e
	}
	var verifiedAt *time.Time
	if in.VerificationToken != "" {
		if !s.validVerification(p, id, in, key, in.VerificationToken, time.Now()) {
			return Config{}, invalid("验证已失效，请重新验证后保存")
		}
		now := time.Now()
		verifiedAt = &now
	} else if old.ID != "" && old.Provider == in.Provider && old.Protocol == in.Protocol && old.BaseURL == in.BaseURL && old.Model == in.Model {
		previous, err := s.open(old, p.TeamID)
		if err != nil {
			return Config{}, err
		}
		if previous == key {
			verifiedAt = old.VerifiedAt
		}
	}
	if old.ID == "" {
		id = store.ID()
	}
	owner := ""
	var ownerArg any
	if in.Scope == "personal" {
		owner = p.UserID
		ownerArg = owner
	}
	sealed, e := s.seal(id, p.TeamID, owner, key)
	if e != nil {
		return old, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return old, e
	}
	defer tx.Rollback(ctx)
	// Serialize default selection within a team without reading anybody else's private key.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "ai-config:"+p.TeamID); e != nil {
		return old, e
	}
	if in.Default {
		if _, e = tx.Exec(ctx, `UPDATE assistant_configs SET is_default=false WHERE team_id=$1 AND owner_id IS NOT DISTINCT FROM $2::text`, p.TeamID, ownerArg); e != nil {
			return old, e
		}
	}
	if old.ID == "" {
		_, e = tx.Exec(ctx, `INSERT INTO assistant_configs(id,team_id,owner_id,name,provider,protocol,base_url,model,secret,is_default,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, p.TeamID, ownerArg, in.Name, in.Provider, in.Protocol, in.BaseURL, in.Model, sealed, in.Default, verifiedAt)
	} else {
		var tag interface{ RowsAffected() int64 }
		tag, e = tx.Exec(ctx, `UPDATE assistant_configs SET name=$1,provider=$2,protocol=$3,base_url=$4,model=$5,secret=$6,is_default=$7,verified_at=$10,revision=revision+1,updated_at=now() WHERE id=$8 AND revision=$9`, in.Name, in.Provider, in.Protocol, in.BaseURL, in.Model, sealed, in.Default, id, in.ExpectedRevision, verifiedAt)
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
	return s.config(ctx, p, id)
}
func (s *Service) DeleteConfig(ctx context.Context, p identity.Principal, id string, revision int) error {
	c, e := s.config(ctx, p, id)
	if e != nil {
		return e
	}
	if !c.Editable {
		return identity.Denied("不能修改此 AI 配置")
	}
	tag, e := s.Pool.Exec(ctx, `DELETE FROM assistant_configs WHERE id=$1 AND revision=$2 AND team_id=$3`, id, revision, p.TeamID)
	if e == nil && tag.RowsAffected() != 1 {
		return conflict()
	}
	return e
}
func (s *Service) VerifyConfig(ctx context.Context, p identity.Principal, id string) (Config, error) {
	c, e := s.config(ctx, p, id)
	if e != nil {
		return c, e
	}
	if !c.Editable {
		return c, identity.Denied("不能修改此 AI 配置")
	}
	if c.VerifiedAt != nil {
		return c, nil
	}
	key, e := s.open(c, p.TeamID)
	if e != nil {
		return c, e
	}
	_, _, _, e = s.call(ctx, c, key, []map[string]any{{"role": "user", "content": "Reply with OK."}}, nil)
	if e != nil {
		return c, e
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE assistant_configs SET verified_at=now() WHERE id=$1 AND revision=$2`, id, c.Revision)
	if e != nil {
		return c, e
	}
	if tag.RowsAffected() != 1 {
		return c, conflict()
	}
	return s.config(ctx, p, id)
}

// Keep response bodies bounded and never include upstream errors (which may echo credentials).
func readBody(r io.Reader) ([]byte, error) {
	b, e := io.ReadAll(io.LimitReader(r, 1<<20+1))
	if len(b) > 1<<20 {
		return nil, invalid("模型回复过长")
	}
	return b, e
}

func (s *Service) enter() (func(), error) {
	if s.Slots == nil {
		return func() {}, nil
	}
	select {
	case s.Slots <- struct{}{}:
		return func() { <-s.Slots }, nil
	default:
		return nil, &identity.Error{Status: 429, Message: "助手正忙，请稍后重试"}
	}
}
