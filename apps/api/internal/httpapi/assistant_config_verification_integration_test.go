package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAssistantDraftVerificationBeforeSave(t *testing.T) {
	repo, svc := identityFixture(t)
	calls := 0
	failModel := false
	client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://models.example.test/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer synthetic-verify-key" {
			t.Fatal("wrong verification destination")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if len(body["messages"].([]any)) != 1 || body["tools"] != nil {
			t.Fatal("verification contains business context/tools")
		}
		if failModel {
			return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader("synthetic-verify-key private provider error"))}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"role":"assistant","content":"OK"}}]}`))}, nil
	})}
	h := NewWithConfig(repo, Config{Identity: svc, BootstrapToken: testBootstrapToken, AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: client})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "verify-owner@example.test", "name": "Owner", "password": "synthetic-password-123", "team_name": "Verify QA"}, 201)
	in := map[string]any{"scope": "personal", "name": "QA", "provider": "compatible", "protocol": "chat-completions", "base_url": "https://models.example.test/v1", "model": "qa-model", "api_key": "synthetic-verify-key"}
	proof := owner.call("POST", "/api/v1/assistant/configs/verify", in, 200)
	if len(owner.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("verification persisted an unsaved config")
	}
	in["verification_token"] = proof["verification_token"]
	in["model"] = "changed-model"
	owner.call("POST", "/api/v1/assistant/configs", in, 400)
	in["model"] = "qa-model"
	saved := owner.call("POST", "/api/v1/assistant/configs", in, 200)
	if saved["verified_at"] == nil {
		t.Fatal("save lost valid proof")
	}
	id := saved["id"].(string)
	owner.call("POST", "/api/v1/assistant/configs/"+id+"/verify", nil, 200)
	if calls != 1 {
		t.Fatal("verified config caused another paid call")
	}
	delete(in, "verification_token")
	in["expected_revision"] = saved["revision"]
	in["api_key"] = ""
	in["name"] = "Renamed"
	saved = owner.call("PUT", "/api/v1/assistant/configs/"+id, in, 200)
	if saved["verified_at"] == nil {
		t.Fatal("rename lost verification")
	}
	in["expected_revision"] = saved["revision"]
	in["model"] = "changed-model"
	saved = owner.call("PUT", "/api/v1/assistant/configs/"+id, in, 200)
	if saved["verified_at"] != nil {
		t.Fatal("changed model retained verification")
	}
	in["id"] = id
	in["expected_revision"] = saved["revision"]
	proof = owner.call("POST", "/api/v1/assistant/configs/verify", in, 200)
	// Draft verification with an existing key leaves its saved state untouched.
	items := owner.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any)
	if items[0].(map[string]any)["verified_at"] != nil {
		t.Fatal("draft verification modified saved config")
	}
	in["verification_token"] = proof["verification_token"]
	saved = owner.call("PUT", "/api/v1/assistant/configs/"+id, in, 200)
	if saved["verified_at"] == nil {
		t.Fatal("edited proof lost")
	}
	in["expected_revision"] = saved["revision"]
	owner.call("PUT", "/api/v1/assistant/configs/"+id, in, 400)
	delete(in, "verification_token")
	in["base_url"] = "https://other.example.test/v1"
	owner.call("POST", "/api/v1/assistant/configs/verify", in, 400)
	if calls != 2 {
		t.Fatal("saved key sent to edited address")
	}
	in["base_url"] = "https://models.example.test/v1"
	invite := owner.call("POST", "/api/v1/invites", map[string]any{"email": "verify-guest@example.test"}, 201)
	guest := &authClient{t: t, h: h}
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite["token"], "name": "Guest", "password": "synthetic-password-123"}, 200)
	guest.call("POST", "/api/v1/assistant/configs/verify", in, 404)
	in["scope"] = "team"
	guest.call("POST", "/api/v1/assistant/configs/verify", in, 403)
	in["scope"] = "personal"
	anon := &authClient{t: t, h: h}
	anon.call("POST", "/api/v1/assistant/configs/verify", in, 401)
	failModel = true
	result := owner.call("POST", "/api/v1/assistant/configs/verify", in, 400)
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "synthetic-verify-key") {
		t.Fatal("provider error leaked key")
	}
}
