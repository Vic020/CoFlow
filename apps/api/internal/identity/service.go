package identity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/mail"
	"strings"
	"time"

	"coflow/api/internal/db"
	"coflow/api/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string      { return e.Message }
func Invalid(message string) error  { return &Error{400, message} }
func Denied(message string) error   { return &Error{403, message} }
func Unauthorized() error           { return &Error{401, "请登录，或提供有效的 Agent 凭证"} }
func conflict(message string) error { return &Error{409, message} }
func notFound(message string) error { return &Error{404, message} }

type Principal struct {
	UserID string   `json:"user_id"`
	TeamID string   `json:"team_id"`
	Role   string   `json:"role"`
	Kind   string   `json:"kind"`
	Scopes []string `json:"scopes"`
}

func (p Principal) Can(scope string) bool {
	if p.Kind == "session" || p.Kind == "demo" {
		return true
	}
	for _, s := range p.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

type Service struct {
	Pool      *pgxpool.Pool
	Q         *db.Queries
	dummyHash []byte
}

func New(pool *pgxpool.Pool) *Service {
	dummy, _ := bcrypt.GenerateFromPassword([]byte("coflow-invalid-login-placeholder"), 12)
	return &Service{pool, db.New(pool), dummy}
}
func Hash(raw string) string { s := sha256.Sum256([]byte(raw)); return hex.EncodeToString(s[:]) }
func secret(prefix string) string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b[:])
}
func stamp(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
func emailAddress(raw string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(raw))
	parsed, err := mail.ParseAddress(s)
	if err != nil || parsed.Address != s || len(s) > 254 {
		return "", Invalid("请输入有效邮箱地址")
	}
	return s, nil
}
func passwordHash(password string) (string, error) {
	if len(password) < 8 || len(password) > 72 {
		return "", Invalid("密码长度需为 8–72 字节")
	}
	b, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(b), err
}
func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 {
		return "", Invalid("名称不能为空，且最多 120 字节")
	}
	return name, nil
}
func (s *Service) Initialized(ctx context.Context) (bool, error) {
	n, err := s.Q.CountUsers(ctx)
	return n > 0, err
}
func (s *Service) newSession(ctx context.Context, q *db.Queries, user, team string) (string, error) {
	raw := secret("cs_")
	return raw, q.CreateSession(ctx, db.CreateSessionParams{TokenHash: Hash(raw), UserID: user, TeamID: team, ExpiresAt: stamp(time.Now().Add(7 * 24 * time.Hour))})
}
func (s *Service) Bootstrap(ctx context.Context, email, name, password, teamName string) (string, error) {
	email, err := emailAddress(email)
	if err != nil {
		return "", err
	}
	name, err = cleanName(name)
	if err != nil {
		return "", err
	}
	teamName, err = cleanName(teamName)
	if err != nil {
		return "", err
	}
	hash, err := passwordHash(password)
	if err != nil {
		return "", err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(734698211)"); err != nil {
		return "", err
	}
	q := s.Q.WithTx(tx)
	n, err := q.CountUsers(ctx)
	if err != nil {
		return "", err
	}
	if n > 0 {
		return "", conflict("工作空间已初始化，请登录或通过邀请加入")
	}
	user, err := q.CreateUser(ctx, db.CreateUserParams{ID: store.ID(), Email: email, Name: name, PasswordHash: hash, Color: "mint"})
	if err != nil {
		return "", err
	}
	team, err := q.CreateTeam(ctx, db.CreateTeamParams{ID: store.ID(), Name: teamName})
	if err != nil {
		return "", err
	}
	if err = q.CreateMembership(ctx, db.CreateMembershipParams{TeamID: team.ID, UserID: user.ID, Role: "admin"}); err != nil {
		return "", err
	}
	if err = q.CreateDefaultProject(ctx, team.ID); err != nil {
		return "", err
	}
	for i, d := range store.Domains {
		if err = q.CreateDomain(ctx, db.CreateDomainParams{TeamID: team.ID, Name: d, Position: int32(i)}); err != nil {
			return "", err
		}
	}
	raw, err := s.newSession(ctx, q, user.ID, team.ID)
	if err != nil {
		return "", err
	}
	return raw, tx.Commit(ctx)
}
func (s *Service) Login(ctx context.Context, email, password string) (string, error) {
	email, err := emailAddress(email)
	if err != nil {
		return "", Unauthorized()
	}
	u, err := s.Q.UserByEmail(ctx, email)
	hash := s.dummyHash
	if err == nil {
		hash = []byte(u.PasswordHash)
	}
	matched := bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if err != nil || !matched {
		return "", &Error{401, "邮箱或密码不正确"}
	}
	teams, err := s.Q.UserTeams(ctx, u.ID)
	if err != nil {
		return "", err
	}
	if len(teams) == 0 {
		return "", Denied("当前账号尚未加入团队，请使用有效邀请")
	}
	return s.newSession(ctx, s.Q, u.ID, teams[0].ID)
}
func (s *Service) Authenticate(ctx context.Context, raw string, agent bool) (Principal, error) {
	if raw == "" || len(raw) > 200 {
		return Principal{}, Unauthorized()
	}
	if agent {
		v, err := s.Q.TokenIdentity(ctx, Hash(raw))
		if errors.Is(err, pgx.ErrNoRows) {
			return Principal{}, Unauthorized()
		}
		if err != nil {
			return Principal{}, err
		}
		if err = s.Q.TouchAgentToken(ctx, v.ID); err != nil {
			return Principal{}, err
		}
		return Principal{v.UserID, v.TeamID, v.Role, "token", v.Scopes}, nil
	}
	v, err := s.Q.SessionIdentity(ctx, Hash(raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, Unauthorized()
	}
	if err != nil {
		return Principal{}, err
	}
	return Principal{v.UserID, v.TeamID, v.Role, "session", []string{}}, nil
}
func (s *Service) Logout(ctx context.Context, raw string) error {
	return s.Q.DeleteSession(ctx, Hash(raw))
}
func (s *Service) Me(ctx context.Context, p Principal) (map[string]any, error) {
	u, err := s.Q.UserByID(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	teams, err := s.Q.UserTeams(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	for _, team := range teams {
		if team.ID == p.TeamID && team.DisplayName != "" {
			u.Name = team.DisplayName
		}
	}
	team, err := s.Q.TeamByID(ctx, p.TeamID)
	if err != nil {
		return nil, err
	}
	prefs, err := s.Preferences(ctx, p)
	if err != nil {
		return nil, err
	}
	return map[string]any{"user": u, "teams": teams, "current_team": p.TeamID, "role": p.Role, "preferences": prefs, "timezone": team.Timezone}, nil
}
func (s *Service) SwitchTeam(ctx context.Context, p Principal, raw, team string) error {
	if _, err := s.Q.Membership(ctx, db.MembershipParams{TeamID: team, UserID: p.UserID}); errors.Is(err, pgx.ErrNoRows) {
		return Denied("你不属于该团队")
	} else if err != nil {
		return err
	}
	return s.Q.SwitchSessionTeam(ctx, db.SwitchSessionTeamParams{TokenHash: Hash(raw), TeamID: team})
}

func (s *Service) CreateWorkspace(ctx context.Context, p Principal, raw, name, displayName string) (string, error) {
	name, err := cleanName(name)
	if err != nil {
		return "", err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	if displayName != "" {
		displayName, err = cleanName(displayName)
		if err != nil {
			return "", err
		}
	}
	team, err := q.CreateTeam(ctx, db.CreateTeamParams{ID: store.ID(), Name: name})
	if err != nil {
		return "", err
	}
	if err = q.CreateMembership(ctx, db.CreateMembershipParams{TeamID: team.ID, UserID: p.UserID, Role: "admin"}); err != nil {
		return "", err
	}
	if displayName != "" {
		if err = q.SetMemberDisplayName(ctx, db.SetMemberDisplayNameParams{TeamID: team.ID, UserID: p.UserID, DisplayName: displayName}); err != nil {
			return "", err
		}
	}
	if err = q.CreateDefaultProject(ctx, team.ID); err != nil {
		return "", err
	}
	for i, d := range store.Domains {
		if err = q.CreateDomain(ctx, db.CreateDomainParams{TeamID: team.ID, Name: d, Position: int32(i)}); err != nil {
			return "", err
		}
	}
	if err = q.SwitchSessionTeam(ctx, db.SwitchSessionTeamParams{TokenHash: Hash(raw), TeamID: team.ID}); err != nil {
		return "", err
	}
	return team.ID, tx.Commit(ctx)
}
func (s *Service) Metadata(ctx context.Context, p Principal) (map[string]any, error) {
	t, err := s.Q.TeamByID(ctx, p.TeamID)
	if err != nil {
		return nil, err
	}
	members, err := s.Q.TeamMembers(ctx, p.TeamID)
	if err != nil {
		return nil, err
	}
	projects, err := s.Q.TeamProjects(ctx, p.TeamID)
	if err != nil {
		return nil, err
	}
	domains, err := s.Q.TeamDomains(ctx, p.TeamID)
	if err != nil {
		return nil, err
	}
	ms := []store.Member{}
	for _, m := range members {
		ms = append(ms, store.Member{ID: m.ID, Name: m.Name, Color: m.Color, AvatarData: m.AvatarData, Role: m.Role})
	}
	ps := []store.Project{}
	for _, v := range projects {
		ps = append(ps, store.Project{ID: v.ID, Name: v.Name, Domains: v.Domains, Status: v.Status})
	}
	if domains == nil {
		domains = []string{}
	}
	return map[string]any{"members": ms, "projects": ps, "domains": domains, "current_user": p.UserID, "role": p.Role, "mode": "team", "timezone": t.Timezone, "team": map[string]string{"id": t.ID, "name": t.Name}}, nil
}
func (s *Service) CreateInvite(ctx context.Context, p Principal, email string) (map[string]any, error) {
	email, err := emailAddress(email)
	if err != nil {
		return nil, err
	}
	if u, e := s.Q.UserByEmail(ctx, email); e == nil {
		if _, e = s.Q.Membership(ctx, db.MembershipParams{TeamID: p.TeamID, UserID: u.ID}); e == nil {
			return nil, conflict("该成员已在团队中")
		}
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	raw := secret("ci_")
	row, err := s.Q.CreateInvite(ctx, db.CreateInviteParams{ID: store.ID(), TeamID: p.TeamID, Email: email, TokenHash: Hash(raw), CreatedBy: p.UserID, ExpiresAt: stamp(time.Now().Add(7 * 24 * time.Hour))})
	if err != nil {
		return nil, err
	}
	return map[string]any{"invite": row, "token": raw}, nil
}
func (s *Service) InviteInfo(ctx context.Context, raw string) (map[string]any, error) {
	v, err := s.Q.InviteByHash(ctx, Hash(raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("邀请不存在或已失效")
	}
	if err != nil {
		return nil, err
	}
	if v.UsedAt.Valid || v.RevokedAt.Valid || time.Now().After(v.ExpiresAt.Time) {
		return nil, &Error{410, "邀请已使用、撤销或过期"}
	}
	return map[string]any{"email": v.Email, "email_domain": v.Email[strings.LastIndex(v.Email, "@")+1:], "inviter_name": v.InviterName, "team_name": v.TeamName, "expires_at": v.ExpiresAt}, nil
}
func (s *Service) AcceptInvite(ctx context.Context, raw, name, password string, authenticatedUser string) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	v, err := q.LockInvite(ctx, Hash(raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", notFound("邀请不存在")
	}
	if err != nil {
		return "", err
	}
	if v.UsedAt.Valid || v.RevokedAt.Valid || time.Now().After(v.ExpiresAt.Time) {
		return "", &Error{410, "邀请已使用、撤销或过期"}
	}
	user, err := q.UserByEmail(ctx, v.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		name, err = cleanName(name)
		if err != nil {
			return "", err
		}
		hash, err := passwordHash(password)
		if err != nil {
			return "", err
		}
		user, err = q.CreateUser(ctx, db.CreateUserParams{ID: store.ID(), Email: v.Email, Name: name, PasswordHash: hash, Color: "blue"})
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else if authenticatedUser != user.ID {
		if authenticatedUser != "" || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
			return "", &Error{401, "该邮箱已有账号，请使用受邀账号的原密码加入"}
		}
	}
	if _, err = q.Membership(ctx, db.MembershipParams{TeamID: v.TeamID, UserID: user.ID}); err == nil {
		return "", conflict("你已加入该团队")
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if err = q.CreateMembership(ctx, db.CreateMembershipParams{TeamID: v.TeamID, UserID: user.ID, Role: "member"}); err != nil {
		return "", err
	}
	if err = q.UseInvite(ctx, v.ID); err != nil {
		return "", err
	}
	token, err := s.newSession(ctx, q, user.ID, v.TeamID)
	if err != nil {
		return "", err
	}
	return token, tx.Commit(ctx)
}
func (s *Service) ListInvites(ctx context.Context, p Principal) ([]db.ListInvitesRow, error) {
	rows, err := s.Q.ListInvites(ctx, p.TeamID)
	out := []db.ListInvitesRow{}
	for _, v := range rows {
		if p.Role == "admin" || v.CreatedBy == p.UserID {
			out = append(out, v)
		}
	}
	return out, err
}
func (s *Service) RevokeInvite(ctx context.Context, p Principal, id string) error {
	rows, err := s.ListInvites(ctx, p)
	if err != nil {
		return err
	}
	found := false
	for _, v := range rows {
		if v.ID == id {
			found = true
		}
	}
	if !found {
		return notFound("邀请不存在")
	}
	n, err := s.Q.RevokeInvite(ctx, db.RevokeInviteParams{ID: id, TeamID: p.TeamID})
	if err != nil {
		return err
	}
	if n == 0 {
		return conflict("邀请已使用")
	}
	return nil
}
func (s *Service) CreateToken(ctx context.Context, p Principal, name string, scopes []string, days int) (map[string]any, error) {
	name, err := cleanName(name)
	if err != nil {
		return nil, err
	}
	if days == 0 {
		days = 90
	}
	if days < 1 || days > 365 {
		return nil, Invalid("凭证有效期需为 1–365 天")
	}
	if len(scopes) == 0 {
		scopes = []string{"reports:read", "reports:write"}
	}
	seen := map[string]bool{}
	clean := []string{}
	for _, scope := range scopes {
		if scope != "reports:read" && scope != "reports:write" && scope != "comments:write" {
			return nil, Invalid("无效的凭证权限")
		}
		if !seen[scope] {
			clean = append(clean, scope)
			seen[scope] = true
		}
	}
	if !seen["reports:read"] {
		return nil, Invalid("凭证需要读取项目和简报的权限")
	}
	raw := secret("cf_")
	row, err := s.Q.CreateAgentToken(ctx, db.CreateAgentTokenParams{ID: store.ID(), TeamID: p.TeamID, UserID: p.UserID, Name: name, TokenHash: Hash(raw), Prefix: raw[:11], Scopes: clean, ExpiresAt: stamp(time.Now().Add(time.Duration(days) * 24 * time.Hour))})
	if err != nil {
		return nil, err
	}
	return map[string]any{"credential": raw, "token": row}, nil
}
func (s *Service) ListTokens(ctx context.Context, p Principal) ([]db.ListAgentTokensRow, error) {
	rows, err := s.Q.ListAgentTokens(ctx, db.ListAgentTokensParams{TeamID: p.TeamID, UserID: p.UserID})
	if rows == nil {
		rows = []db.ListAgentTokensRow{}
	}
	return rows, err
}
func (s *Service) RevokeToken(ctx context.Context, p Principal, id string) error {
	n, err := s.Q.RevokeAgentToken(ctx, db.RevokeAgentTokenParams{ID: id, TeamID: p.TeamID, UserID: p.UserID})
	if err != nil {
		return err
	}
	if n == 0 {
		return notFound("凭证不存在")
	}
	return nil
}
func (s *Service) RemoveMember(ctx context.Context, p Principal, id string) error {
	if p.Role != "admin" {
		return Denied("Only administrators can remove members")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	n, err := q.DeleteMember(ctx, db.DeleteMemberParams{TeamID: p.TeamID, UserID: id})
	if err != nil {
		return err
	}
	if n == 0 {
		return Denied("Cannot remove an administrator or unknown member")
	}
	if err = q.RevokeMemberTokens(ctx, db.RevokeMemberTokensParams{TeamID: p.TeamID, UserID: id}); err != nil {
		return err
	}
	if err = q.DeleteMemberSessions(ctx, db.DeleteMemberSessionsParams{TeamID: p.TeamID, UserID: id}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateMemberRole serializes role changes per team so concurrent demotions cannot
// remove the last administrator. Recheck the caller after acquiring the lock.
func (s *Service) UpdateMemberRole(ctx context.Context, p Principal, id, role string) error {
	if p.Kind != "session" || p.Role != "admin" {
		return Denied("只有网页管理员可以修改成员角色")
	}
	if role != "admin" && role != "member" {
		return Invalid("角色必须是管理员或成员")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var team string
	if err = tx.QueryRow(ctx, "SELECT id FROM teams WHERE id=$1 FOR UPDATE", p.TeamID).Scan(&team); err != nil {
		return err
	}
	var callerRole string
	err = tx.QueryRow(ctx, "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2", p.TeamID, p.UserID).Scan(&callerRole)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && callerRole != "admin") {
		return Denied("只有网页管理员可以修改成员角色")
	}
	if err != nil {
		return err
	}
	var current string
	err = tx.QueryRow(ctx, "SELECT role FROM memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE", p.TeamID, id).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return notFound("成员不存在")
	}
	if err != nil {
		return err
	}
	if current == "admin" && role == "member" {
		var admins int
		if err = tx.QueryRow(ctx, "SELECT count(*) FROM memberships WHERE team_id=$1 AND role='admin'", p.TeamID).Scan(&admins); err != nil {
			return err
		}
		if admins <= 1 {
			return conflict("团队至少需要一位管理员")
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE memberships SET role=$3 WHERE team_id=$1 AND user_id=$2", p.TeamID, id, role); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
