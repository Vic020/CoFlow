package httpapi

import (
	"errors"
	"testing"

	"coflow/api/internal/identity"
)

func TestMemberRolePermissionsAndLastAdministrator(t *testing.T) {
	repo, service := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: service, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "roles-owner@example.test", "name": "Owner", "password": "synthetic-owner-password", "team_name": "Roles QA"}, 201)
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	ownerID := me["user"].(map[string]any)["id"].(string)
	team := me["current_team"].(string)
	issued := owner.call("POST", "/api/v1/invites", map[string]any{"email": "roles-member@example.test"}, 201)
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": issued["token"], "name": "Member", "password": "synthetic-member-password"}, 200)
	guestMe := guest.call("GET", "/api/v1/auth/me", nil, 200)
	guestID := guestMe["user"].(map[string]any)["id"].(string)
	admin := map[string]any{"role": "admin"}
	member := map[string]any{"role": "member"}
	guest.call("PATCH", "/api/v1/members/"+guestID, admin, 403)
	owner.call("PATCH", "/api/v1/members/"+guestID, map[string]any{"role": "owner"}, 400)
	owner.call("PATCH", "/api/v1/members/not-in-this-team", admin, 404)
	owner.call("PATCH", "/api/v1/members/"+ownerID, member, 409)
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Role QA Agent", "scopes": []string{"reports:read", "reports:write", "comments:write"}}, 201)
	agent := &authClient{t: t, h: h, token: token["credential"].(string)}
	agent.call("PATCH", "/api/v1/members/"+guestID, admin, 403)
	owner.call("PATCH", "/api/v1/members/"+guestID, admin, 200)
	if guest.call("GET", "/api/v1/meta", nil, 200)["role"] != "admin" {
		t.Fatal("promotion did not affect existing session")
	}
	guest.call("PATCH", "/api/v1/members/"+ownerID, member, 200)
	owner.call("PATCH", "/api/v1/members/"+ownerID, admin, 403)
	if owner.call("GET", "/api/v1/meta", nil, 200)["role"] != "member" {
		t.Fatal("demotion did not affect existing session")
	}
	guest.call("PATCH", "/api/v1/members/"+ownerID, admin, 200)
	// Two in-flight administrators demoting themselves must leave one admin.
	results := make(chan error, 2)
	for _, id := range []string{ownerID, guestID} {
		go func(id string) {
			results <- service.UpdateMemberRole(t.Context(), identity.Principal{UserID: id, TeamID: team, Kind: "session", Role: "admin"}, id, "member")
		}(id)
	}
	successes := 0
	for range 2 {
		err := <-results
		if err == nil {
			successes++
			continue
		}
		var e *identity.Error
		if !errors.As(err, &e) || e.Status != 409 {
			t.Fatalf("unexpected demotion error: %v", err)
		}
	}
	var admins int
	if err := repo.Pool().QueryRow(t.Context(), "SELECT count(*) FROM memberships WHERE team_id=$1 AND role='admin'", team).Scan(&admins); err != nil {
		t.Fatal(err)
	}
	if successes != 1 || admins != 1 {
		t.Fatalf("successes=%d admins=%d", successes, admins)
	}
	// Stale principals cannot retain privileges after demotion.
	var demoted string
	if err := repo.Pool().QueryRow(t.Context(), "SELECT user_id FROM memberships WHERE team_id=$1 AND role='member'", team).Scan(&demoted); err != nil {
		t.Fatal(err)
	}
	err := service.UpdateMemberRole(t.Context(), identity.Principal{UserID: demoted, TeamID: team, Kind: "session", Role: "admin"}, demoted, "admin")
	var denied *identity.Error
	if !errors.As(err, &denied) || denied.Status != 403 {
		t.Fatalf("stale role was trusted: %v", err)
	}
}
