package httpapi

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"testing"
)

func TestPersonalProfileAndPassword(t *testing.T) {
	_, service := identityFixture(t)
	h := NewWithConfig(nil, Config{Identity: service, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	otherSession := &authClient{t: t, h: h}
	const oldPassword = "synthetic-original-password"
	const newPassword = "synthetic-updated-password"
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "profile@example.test", "name": "Original", "team_name": "Profile QA", "password": oldPassword}, 201)
	otherSession.call("POST", "/api/v1/auth/login", map[string]any{"email": "profile@example.test", "password": oldPassword}, 200)
	me := owner.call("GET", "/api/v1/auth/me", nil, 200)
	firstTeam := me["current_team"].(string)
	if me["timezone"] != "Asia/Shanghai" {
		t.Fatal("missing team time zone")
	}
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Profile QA Agent", "scopes": []string{"reports:read", "reports:write"}}, 201)
	agent := &authClient{t: t, h: h, token: token["credential"].(string)}
	agent.call("PATCH", "/api/v1/auth/profile", map[string]any{"name": "Spoof"}, 403)
	agent.call("POST", "/api/v1/auth/password", map[string]any{"current_password": oldPassword, "new_password": newPassword}, 403)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 32, 32))); err != nil {
		t.Fatal(err)
	}
	avatar := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	for _, invalid := range []string{"https://example.test/avatar.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,aW52YWxpZA=="} {
		owner.call("PATCH", "/api/v1/auth/profile", map[string]any{"name": "Should not save", "avatar_data": invalid}, 400)
	}
	owner.call("PATCH", "/api/v1/auth/profile", map[string]any{"name": "Captain", "avatar_data": avatar, "user_id": "another-user"}, 200)
	updated := owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)
	if updated["name"] != "Captain" || updated["avatar_data"] != avatar || updated["email"] != "profile@example.test" {
		t.Fatal("profile update failed")
	}
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Other team", "display_name": "Other name"}, 201)
	second := owner.call("GET", "/api/v1/auth/me", nil, 200)
	if second["user"].(map[string]any)["name"] != "Other name" || second["user"].(map[string]any)["avatar_data"] != avatar {
		t.Fatal("avatar/name team boundaries failed")
	}
	owner.call("PATCH", "/api/v1/auth/profile", map[string]any{"name": "Other captain"}, 200)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": firstTeam}, 200)
	if owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["name"] != "Captain" {
		t.Fatal("nickname changed across teams")
	}
	owner.call("POST", "/api/v1/auth/password", map[string]any{"current_password": "wrong", "new_password": newPassword}, 400)
	owner.call("POST", "/api/v1/auth/password", map[string]any{"current_password": oldPassword, "new_password": "short"}, 400)
	otherSession.call("GET", "/api/v1/auth/me", nil, 200)
	owner.call("POST", "/api/v1/auth/password", map[string]any{"current_password": oldPassword, "new_password": newPassword}, 200)
	owner.call("GET", "/api/v1/auth/me", nil, 200)
	otherSession.call("GET", "/api/v1/auth/me", nil, 401)
	login := &authClient{t: t, h: h}
	login.call("POST", "/api/v1/auth/login", map[string]any{"email": "profile@example.test", "password": oldPassword}, 401)
	login.call("POST", "/api/v1/auth/login", map[string]any{"email": "profile@example.test", "password": newPassword}, 200)
	owner.call("PATCH", "/api/v1/auth/profile", map[string]any{"name": "Captain", "avatar_data": ""}, 200)
	if owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["avatar_data"] != "" {
		t.Fatal("avatar removal failed")
	}
}
