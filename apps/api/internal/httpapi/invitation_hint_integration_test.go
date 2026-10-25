package httpapi

import "testing"

func TestInvitationHintsUseTeamDisplayName(t *testing.T) {
	repo, service := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: service, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	guest := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "inviter@example.test", "name": "Global Name", "password": "synthetic-invite-password", "team_name": "Invitation QA"}, 201)
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	user := me["user"].(map[string]any)["id"].(string)
	team := me["current_team"].(string)
	if _, err := repo.Pool().Exec(t.Context(), "UPDATE memberships SET display_name=$1 WHERE team_id=$2 AND user_id=$3", "Team Captain", team, user); err != nil {
		t.Fatal(err)
	}
	issued := owner.call("POST", "/api/v1/invites", map[string]any{"email": "invitee+qa@sub.example.test"}, 201)
	info := guest.call("POST", "/api/v1/auth/invite-info", map[string]any{"token": issued["token"]}, 200)
	for key, want := range map[string]string{"inviter_name": "Team Captain", "email_domain": "sub.example.test", "team_name": "Invitation QA", "email": "invitee+qa@sub.example.test"} {
		if info[key] != want {
			t.Fatalf("%s: got %v, want %s", key, info[key], want)
		}
	}
	if len(info) != 5 || info["expires_at"] == nil {
		t.Fatal("invitation info should expose only target email, domain, inviter name, team name and expiry")
	}
	owner.call("DELETE", "/api/v1/invites/"+issued["invite"].(map[string]any)["id"].(string), nil, 200)
	guest.call("POST", "/api/v1/auth/invite-info", map[string]any{"token": issued["token"]}, 410)
}
