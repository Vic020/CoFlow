package httpapi

import (
	"bytes"
	migrations "coflow/api/db"
	"coflow/api/internal/db"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"
)

type authClient struct {
	t      *testing.T
	h      http.Handler
	cookie *http.Cookie
	token  string
}

func (a *authClient) call(method, path string, input any, want int) map[string]any {
	a.t.Helper()
	body, _ := json.Marshal(input)
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if a.cookie != nil {
		r.AddCookie(a.cookie)
	}
	if a.token != "" {
		r.Header.Set("Authorization", "Bearer "+a.token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, r)
	if w.Code != want {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &e)
		a.t.Fatalf("%s %s: expected %d, got %d (%s)", method, path, want, w.Code, e.Error)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie {
			if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
				a.t.Fatal("session cookie protections missing")
			}
			a.cookie = c
		}
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		a.t.Fatal(err)
	}
	return out
}
func identityFixture(t *testing.T) (*store.Postgres, *identity.Service) {
	t.Helper()
	connection := os.Getenv("COFLOW_TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("set COFLOW_TEST_DATABASE_URL to run PostgreSQL identity integration tests")
	}
	ctx := t.Context()
	admin, err := pgxpool.New(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	schema := "coflow_test_" + store.ID()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(connection)
	if err != nil {
		t.Fatal(err)
	}
	values := u.Query()
	values.Set("search_path", schema)
	u.RawQuery = values.Encode()
	repo, err := store.NewPostgres(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		repo.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		admin.Close()
	})
	if err = migrations.Apply(ctx, repo.Pool()); err != nil {
		t.Fatal(err)
	}
	if err = migrations.Apply(ctx, repo.Pool()); err != nil {
		t.Fatal("migration rerun:", err)
	}
	return repo, identity.New(repo.Pool())
}
func TestPostgresIdentityAndAgentFlow(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	ctx := t.Context()
	owner.call("GET", "/api/v1/reports", nil, 401)
	if owner.call("GET", "/api/v1/auth/status", nil, 200)["initialized"] != false {
		t.Fatal("fresh schema already initialized")
	}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "Owner@Example.com", "name": "Owner", "password": "test-owner-password-123", "team_name": "Integration Team"}, 201)
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "other@example.com", "name": "Other", "password": "test-owner-password-123", "team_name": "Other"}, 409)
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	ownerID := me["user"].(map[string]any)["id"].(string)
	teamID := me["current_team"].(string)
	if _, leaked := me["user"].(map[string]any)["password_hash"]; leaked {
		t.Fatal("password hash leaked")
	}
	one := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Owner Agent"}, 201)
	rawOwner := one["credential"].(string)
	ownerTokenID := one["token"].(map[string]any)["id"].(string)
	agent := &authClient{t: t, h: h, token: rawOwner}
	agent.call("GET", "/api/v1/tokens", nil, 403)
	forged := &authClient{t: t, h: h, cookie: owner.cookie, token: "invalid"}
	forged.call("GET", "/api/v1/reports", nil, 401)
	payload := map[string]any{"source_id": "daily-1", "title": "Owner work", "project_id": "general", "domain": "研发", "author_id": "spoof", "team_id": "spoof"}
	report := agent.call("POST", "/api/v1/reports", payload, 200)
	id := report["id"].(string)
	if report["author_id"] != ownerID || report["team_id"] != teamID {
		t.Fatal("identity spoofing succeeded")
	}
	if agent.call("POST", "/api/v1/reports", payload, 200)["id"] != id {
		t.Fatal("idempotency failed")
	}
	invitation := owner.call("POST", "/api/v1/invites", map[string]any{"email": "member@example.com"}, 201)
	invite := invitation["token"].(string)
	guest.call("POST", "/api/v1/auth/invite-info", map[string]any{"token": invite}, 200)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite, "name": "Member", "password": "test-member-password-123"}, 200)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite, "name": "Member", "password": "test-member-password-123"}, 410)
	memberMe := guest.call("GET", "/api/v1/auth/me", nil, 200)
	memberID := memberMe["user"].(map[string]any)["id"].(string)
	second := guest.call("POST", "/api/v1/tokens", map[string]any{"name": "Member Agent", "scopes": []string{"reports:read", "reports:write", "comments:write"}}, 201)
	rawMember := second["credential"].(string)
	memberTokenID := second["token"].(map[string]any)["id"].(string)
	memberAgent := &authClient{t: t, h: h, token: rawMember}
	r2 := memberAgent.call("POST", "/api/v1/reports", payload, 200)
	if r2["author_id"] != memberID || r2["id"] == id {
		t.Fatal("report owner or unique scope incorrect")
	}
	guest.call("PATCH", "/api/v1/reports/"+id, map[string]any{"status": "resolved"}, 403)
	agent.call("PATCH", "/api/v1/reports/"+r2["id"].(string), map[string]any{"status": "resolved"}, 403)
	owner.call("PATCH", "/api/v1/reports/"+r2["id"].(string), map[string]any{"status": "resolved"}, 200)
	memberAgent.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "Feedback"}, 201)
	agent.call("POST", "/api/v1/reports/"+id+"/comments", map[string]any{"body": "Unauthorized comment"}, 403)
	rows := agent.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)
	if len(rows) != 2 {
		t.Fatal("team reports missing")
	}
	readonly := guest.call("POST", "/api/v1/tokens", map[string]any{"name": "Read only", "scopes": []string{"reports:read"}}, 201)
	reader := &authClient{t: t, h: h, token: readonly["credential"].(string)}
	reader.call("POST", "/api/v1/reports", payload, 403)
	guest.call("DELETE", "/api/v1/tokens/"+ownerTokenID, nil, 404)
	owner.call("DELETE", "/api/v1/tokens/"+memberTokenID, nil, 404)
	owner.call("DELETE", "/api/v1/tokens/"+ownerTokenID, nil, 200)
	agent.call("GET", "/api/v1/reports", nil, 401)
	// Only hashes are stored, and revoked/expired tokens stop working immediately.
	var stored string
	if err := repo.Pool().QueryRow(ctx, "SELECT token_hash FROM agent_tokens WHERE id=$1", memberTokenID).Scan(&stored); err != nil || stored == rawMember || stored != identity.Hash(rawMember) {
		t.Fatal("token hashing failed")
	}
	if _, err := repo.Pool().Exec(ctx, "UPDATE agent_tokens SET expires_at=$2 WHERE id=$1", memberTokenID, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	memberAgent.call("GET", "/api/v1/reports", nil, 401)
	// A second team does not see the first team's reports; the token is bound to its original team.
	other, err := s.Q.CreateTeam(ctx, db.CreateTeamParams{ID: store.ID(), Name: "Other team"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Q.CreateMembership(ctx, db.CreateMembershipParams{TeamID: other.ID, UserID: memberID, Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	guest.call("POST", "/api/v1/auth/team", map[string]any{"team_id": other.ID}, 200)
	if len(guest.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("cross-team records leaked")
	}
	guest.call("PATCH", "/api/v1/reports/"+id, map[string]any{"status": "resolved"}, 404)
	if len(reader.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)) != 2 {
		t.Fatal("token did not retain its bound team")
	}
	guest.call("POST", "/api/v1/auth/team", map[string]any{"team_id": teamID}, 200)
	guest.call("DELETE", "/api/v1/members/"+ownerID, nil, 403)
	owner.call("DELETE", "/api/v1/members/"+memberID, nil, 200)
	guest.call("GET", "/api/v1/reports", nil, 401)
	reader.call("GET", "/api/v1/reports", nil, 401)
	var remaining int
	if err := repo.Pool().QueryRow(ctx, "SELECT count(*) FROM agent_tokens WHERE user_id=$1 AND team_id=$2 AND revoked_at IS NULL", memberID, teamID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("removed member retained credentials")
	}
	owner.call("POST", "/api/v1/auth/logout", nil, 200)
	owner.call("GET", "/api/v1/reports", nil, 401)
	login := &authClient{t: t, h: h}
	login.call("POST", "/api/v1/auth/login", map[string]any{"email": "owner@example.com", "password": "incorrect"}, 401)
	login.call("POST", "/api/v1/auth/login", map[string]any{"email": "owner@example.com", "password": "test-owner-password-123"}, 200)
	canceled := login.call("POST", "/api/v1/invites", map[string]any{"email": "canceled@example.com"}, 201)
	login.call("DELETE", "/api/v1/invites/"+canceled["invite"].(map[string]any)["id"].(string), nil, 200)
	login.call("POST", "/api/v1/auth/invite-info", map[string]any{"token": canceled["token"]}, 410)
}

func TestConcurrentInvitationAndExistingAccount(t *testing.T) {
	repo, s := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: s})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "race-owner@example.com", "name": "Owner", "password": "race-owner-password-123", "team_name": "Race Team"}, 201)
	invitation := owner.call("POST", "/api/v1/invites", map[string]any{"email": "race-member@example.com"}, 201)
	token := invitation["token"].(string)
	input, _ := json.Marshal(map[string]any{"token": token, "name": "Member", "password": "race-member-password-123"})
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			r := httptest.NewRequest("POST", "/api/v1/auth/accept-invite", bytes.NewReader(input))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			codes <- w.Code
		}()
	}
	first, second := <-codes, <-codes
	if !((first == 200 && second == 410) || (first == 410 && second == 200)) {
		t.Fatalf("concurrent invite results %d, %d", first, second)
	}
	// Existing-account acceptance must verify the original password, never replace it.
	member := &authClient{t: t, h: h}
	member.call("POST", "/api/v1/auth/login", map[string]any{"email": "race-member@example.com", "password": "race-member-password-123"}, 200)
	expired := owner.call("POST", "/api/v1/invites", map[string]any{"email": "expired@example.com"}, 201)
	expiredID := expired["invite"].(map[string]any)["id"].(string)
	if _, err := repo.Pool().Exec(t.Context(), "UPDATE invites SET expires_at=now()-interval '1 day' WHERE id=$1", expiredID); err != nil {
		t.Fatal(err)
	}
	owner.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": expired["token"], "name": "Expired", "password": "expired-password-123"}, 410)
	u, err := s.Q.UserByEmail(t.Context(), "race-owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Q.CreateTeam(t.Context(), db.CreateTeamParams{ID: store.ID(), Name: "Another Team"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Q.CreateMembership(t.Context(), db.CreateMembershipParams{TeamID: other.ID, UserID: u.ID, Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": other.ID}, 200)
	inviteAgain := owner.call("POST", "/api/v1/invites", map[string]any{"email": "race-member@example.com"}, 201)
	anon := &authClient{t: t, h: h}
	anon.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": inviteAgain["token"], "name": "Impersonation", "password": "wrong-password-123"}, 401)
	anon.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": inviteAgain["token"], "password": "race-member-password-123"}, 200)
	check := &authClient{t: t, h: h}
	check.call("POST", "/api/v1/auth/login", map[string]any{"email": "race-member@example.com", "password": "race-member-password-123"}, 200)
}
