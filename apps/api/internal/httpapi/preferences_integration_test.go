package httpapi

import "testing"

func TestPersonalLanguagePreferences(t *testing.T) {
	repo, service := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: service, BootstrapToken: testBootstrapToken})
	owner := &authClient{t: t, h: h}
	owner.call("GET", "/api/v1/auth/preferences", nil, 401)
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "locale-owner@example.test", "name": "Owner", "password": "synthetic-password-123", "team_name": "Language QA"}, 201)
	if owner.call("GET", "/api/v1/auth/preferences", nil, 200)["locale"] != "en" {
		t.Fatal("default must be English")
	}
	owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": "zh-CN"}, 200)
	saved := owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{"display_timezone": "America/Los_Angeles"}, 200)
	if saved["locale"] != "zh-CN" || saved["display_timezone"] != "America/Los_Angeles" {
		t.Fatal("time zone must not reset language")
	}
	for _, zone := range []string{"", "Local", "invalid-zone"} {
		owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{"display_timezone": zone}, 400)
	}
	owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{}, 400)
	owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": "unsupported"}, 400)
	owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": ""}, 400)
	if owner.call("GET", "/api/v1/auth/me", nil, 200)["preferences"].(map[string]any)["locale"] != "zh-CN" {
		t.Fatal("me must expose the saved preference")
	}
	otherSession := &authClient{t: t, h: h}
	otherSession.call("POST", "/api/v1/auth/login", map[string]any{"email": "locale-owner@example.test", "password": "synthetic-password-123"}, 200)
	if otherSession.call("GET", "/api/v1/auth/preferences", nil, 200)["locale"] != "zh-CN" {
		t.Fatal("preference must survive a new session")
	}
	if otherSession.call("GET", "/api/v1/auth/preferences", nil, 200)["display_timezone"] != "America/Los_Angeles" {
		t.Fatal("time zone must persist across sessions")
	}
	invite := owner.call("POST", "/api/v1/invites", map[string]any{"email": "locale-guest@example.test"}, 201)
	guest := &authClient{t: t, h: h}
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite["token"], "name": "Guest", "password": "synthetic-guest-password"}, 200)
	if guest.call("GET", "/api/v1/auth/preferences", nil, 200)["locale"] != "en" {
		t.Fatal("another account must not inherit owner language")
	}
	if guest.call("GET", "/api/v1/auth/preferences", nil, 200)["display_timezone"] != "Asia/Shanghai" {
		t.Fatal("another user must not inherit a time zone")
	}
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Preferences QA", "scopes": []string{"reports:read", "reports:write"}, "expires_in_days": 1}, 201)["credential"].(string)
	agent := &authClient{t: t, h: h, token: token}
	agent.call("GET", "/api/v1/auth/preferences", nil, 403)
	agent.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": "en"}, 403)
	agent.call("PATCH", "/api/v1/auth/preferences", map[string]any{"display_timezone": "UTC"}, 403)
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Another team", "display_name": "Owner"}, 201)
	if owner.call("GET", "/api/v1/auth/preferences", nil, 200)["locale"] != "zh-CN" {
		t.Fatal("language belongs to the account, not the team")
	}
	otherSession.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": "en"}, 200)
	if owner.call("GET", "/api/v1/auth/preferences", nil, 200)["locale"] != "en" {
		t.Fatal("saved language must sync between sessions")
	}
	if owner.call("GET", "/api/v1/auth/preferences", nil, 200)["display_timezone"] != "America/Los_Angeles" {
		t.Fatal("language changes and team switches must retain the time zone")
	}
	guest.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": "zh-CN"}, 200)
	guestID := guest.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"]
	owner.call("PATCH", "/api/v1/auth/preferences", map[string]any{"locale": "en", "user_id": guestID}, 200)
	if guest.call("GET", "/api/v1/auth/preferences", nil, 200)["locale"] != "zh-CN" {
		t.Fatal("an ownership selector must never modify another account")
	}

}
