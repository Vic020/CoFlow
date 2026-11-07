package httpapi

import (
	"coflow/api/internal/identity"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestWebConfigScopeProofAndRevocation(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "find_todos", map[string]any{})
	calls := 0
	client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.tavily.com" || r.Header.Get("Authorization") != "Bearer synthetic-independent-web" {
			t.Fatal("secret routed to wrong vendor")
		}
		raw := `{"results":[]}`
		if r.URL.Path == "/extract" {
			raw = `{"results":[{"url":"https://example.com/","raw_content":"Public content"}]}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
	})}
	// Keep synthetic identity/session data, replace only the disposable server transport.
	svc := identity.New(repo.Pool())
	h := NewWithConfig(repo, Config{Identity: svc, AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: client})
	owner.h = h
	guest.h = h
	input := map[string]any{"scope": "personal", "provider": "tavily", "name": "Account search", "api_key": "synthetic-independent-web", "is_default": true}
	anon := &authClient{t: t, h: h}
	anon.call("GET", "/api/v1/assistant/web-configs", nil, 401)
	owner.call("POST", "/api/v1/assistant/web-configs", input, 400)
	proof := owner.call("POST", "/api/v1/assistant/web-configs/verify", input, 200)
	if len(owner.call("GET", "/api/v1/assistant/web-configs", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("verification saved draft")
	}
	input["verification_token"] = proof["verification_token"]
	guest.call("POST", "/api/v1/assistant/web-configs", input, 400)
	saved := owner.call("POST", "/api/v1/assistant/web-configs", input, 200)
	id := saved["id"].(string)
	if calls != 2 || saved["verified_at"] == nil {
		t.Fatal("save repeated calls or lost verification")
	}
	raw, _ := json.Marshal(saved)
	if strings.Contains(string(raw), "synthetic-independent-web") || strings.Contains(string(raw), "secret") {
		t.Fatal("secret leaked")
	}
	var secret []byte
	if e := repo.Pool().QueryRow(t.Context(), `SELECT secret FROM assistant_web_configs WHERE id=$1`, id).Scan(&secret); e != nil || strings.Contains(string(secret), "synthetic-independent-web") {
		t.Fatal("not encrypted", e)
	}
	guest.call("PUT", "/api/v1/assistant/web-configs/"+id, input, 404)
	guest.call("DELETE", "/api/v1/assistant/web-configs/"+id, map[string]any{"expected_revision": 1}, 404)
	guest.call("POST", "/api/v1/assistant/web-configs/verify", map[string]any{"scope": "team"}, 403)
	teamInput := map[string]any{"scope": "team", "provider": "tavily", "name": "Shared web", "api_key": "synthetic-independent-web", "is_default": true}
	teamProof := owner.call("POST", "/api/v1/assistant/web-configs/verify", teamInput, 200)
	teamInput["verification_token"] = teamProof["verification_token"]
	shared := owner.call("POST", "/api/v1/assistant/web-configs", teamInput, 200)
	sharedItems := guest.call("GET", "/api/v1/assistant/web-configs", nil, 200)["items"].([]any)
	if len(sharedItems) != 1 || sharedItems[0].(map[string]any)["editable"] != false {
		t.Fatal("shared web visibility/edit boundary")
	}
	guest.call("DELETE", "/api/v1/assistant/web-configs/"+shared["id"].(string), map[string]any{"expected_revision": 1}, 403)
	baseline := calls
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Independent web second team", "display_name": "Owner"}, 201)
	if items := owner.call("GET", "/api/v1/assistant/web-configs", nil, 200)["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != id {
		t.Fatal("account search lost across spaces")
	}
	delete(input, "verification_token")
	delete(input, "api_key")
	input["expected_revision"] = 1
	input["name"] = "Renamed"
	saved = owner.call("PUT", "/api/v1/assistant/web-configs/"+id, input, 200)
	if calls != baseline || saved["verified_at"] == nil {
		t.Fatal("rename reverified")
	}
	input["expected_revision"] = 2
	input["provider"] = "deepseek"
	owner.call("PUT", "/api/v1/assistant/web-configs/"+id, input, 400)
	owner.call("DELETE", "/api/v1/assistant/web-configs/"+id, map[string]any{"expected_revision": 1}, 409)
	owner.call("DELETE", "/api/v1/assistant/web-configs/"+id, map[string]any{"expected_revision": 2}, 200)
	if len(owner.call("GET", "/api/v1/assistant/web-configs", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("delete failed")
	}
}
