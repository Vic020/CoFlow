package httpapi

import (
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAssistantModelsSavedKeyIsolation(t *testing.T) {
	repo, svc := identityFixture(t)
	calls := 0
	client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://models.example.test/v1/models" || r.Header.Get("Authorization") != "Bearer synthetic-models-key" {
			t.Fatal("key sent to incorrect destination")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[{"id":"synthetic-chat"}]}`))}, nil
	})}
	h := NewWithConfig(repo, Config{Identity: svc, BootstrapToken: testBootstrapToken, AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: client})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "models-owner@example.test", "name": "Owner", "password": "synthetic-password-123", "team_name": "Models QA"}, 201)
	invite := owner.call("POST", "/api/v1/invites", map[string]any{"email": "models-guest@example.test"}, 201)
	guest := &authClient{t: t, h: h}
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite["token"], "name": "Guest", "password": "synthetic-password-123"}, 200)
	anon := &authClient{t: t, h: h}
	anon.call("POST", "/api/v1/assistant/models", map[string]any{}, 401)
	create := func(scope string) map[string]any {
		return owner.call("POST", "/api/v1/assistant/configs", map[string]any{"scope": scope, "name": "Models QA", "provider": "compatible", "protocol": "chat-completions", "base_url": "https://models.example.test/v1", "model": "keep-selected-model", "api_key": "synthetic-models-key"}, 200)
	}
	c := create("personal")
	in := map[string]any{"provider": "compatible", "base_url": "https://models.example.test/v1", "config_id": c["id"], "expected_revision": c["revision"]}
	v := owner.call("POST", "/api/v1/assistant/models", in, 200)
	if len(v["items"].([]any)) != 1 {
		t.Fatal("missing models")
	}
	guest.call("POST", "/api/v1/assistant/models", in, 404)
	in["base_url"] = "https://other.example.test/v1"
	owner.call("POST", "/api/v1/assistant/models", in, 400)
	in["base_url"] = "https://models.example.test/v1"
	in["provider"] = "openai"
	owner.call("POST", "/api/v1/assistant/models", in, 400)
	in["provider"] = "compatible"
	in["expected_revision"] = 999
	owner.call("POST", "/api/v1/assistant/models", in, 409)
	shared := create("team")
	in["config_id"] = shared["id"]
	in["expected_revision"] = shared["revision"]
	guest.call("POST", "/api/v1/assistant/models", in, 403)
	owner.call("POST", "/api/v1/assistant/models", in, 200)
	if calls != 2 {
		t.Fatalf("unauthorized discovery reached provider: %d", calls)
	}
	items := owner.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any)
	for _, item := range items {
		c := item.(map[string]any)
		if c["verified_at"] != nil || c["model"] != "keep-selected-model" || c["revision"] != float64(1) {
			t.Fatal("discovery mutated configuration")
		}
	}
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Models Agent", "scopes": []string{"todos:read"}, "expires_in_days": 1}, 201)["credential"].(string)
	agent := &authClient{t: t, h: h, token: token}
	agent.call("POST", "/api/v1/assistant/models", in, 403)
}
