package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAssistantBehaviorAndSharedTranscript(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "read_workspace", map[string]any{})
	config := configureAI(owner, "personal")
	if owner.call("GET", "/api/v1/assistant/behavior", nil, 200)["model_retries"] != float64(2) {
		t.Fatal("missing retry default")
	}
	settings := map[string]any{"model_retries": 1, "system_prompt_append": "Use a compact table.", "revision": 0}
	saved := owner.call("PATCH", "/api/v1/assistant/behavior", settings, 200)
	owner.call("PATCH", "/api/v1/assistant/behavior", settings, 409)
	if guest.call("GET", "/api/v1/assistant/behavior", nil, 200)["system_prompt_append"] != "" {
		t.Fatal("personal prompt exposed")
	}
	count := 0
	client := &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		count++
		var input struct {
			Messages []map[string]any `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		prompt, _ := input.Messages[0]["content"].(string)
		if !strings.HasPrefix(prompt, "You are CoFlow's delivery assistant.") || !strings.HasSuffix(prompt, "Use a compact table.") {
			t.Error("custom prompt did not append to system defaults")
		}
		if count == 1 {
			return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("{}"))}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"Synthetic reply"}}]}`))}, nil
	})}
	owner.h = NewWithConfig(repo, Config{Identity: identity.New(repo.Pool()), AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: client})
	guest.h = owner.h
	out := proposal(owner, config)
	if count != 2 || out["turn"].(map[string]any)["model_retries"] != float64(1) {
		t.Fatal("temporary response was not retried within the budget")
	}
	path := "/api/v1/assistant/conversations/" + out["conversation_id"].(string)
	c := owner.call("GET", path, nil, 200)
	in := map[string]any{"revision": c["revision"]}
	guest.call("POST", path+"/share", in, 409)
	share := owner.call("POST", path+"/share", in, 201)
	link := "/api/v1/assistant/shares/" + share["id"].(string)
	guest.call("GET", path, nil, 404)
	copy := guest.call("GET", link, nil, 200)
	turn := copy["turns"].([]any)[0].(map[string]any)
	if turn["reply"] != "Synthetic reply" || len(turn) != 2 {
		t.Fatal("shared transcript includes unexpected content")
	}
	anonymous := &authClient{t: t, h: owner.h}
	anonymous.call("GET", link, nil, 401)
	other := owner.call("POST", "/api/v1/teams", map[string]any{"name": "Other assistant team"}, 201)
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": other["id"]}, 200)
	owner.call("GET", link, nil, 404)
	if owner.call("GET", "/api/v1/assistant/behavior", nil, 200)["revision"] != saved["revision"] {
		t.Fatal("personal behavior changed across workspaces")
	}
	team := guest.call("GET", "/api/v1/meta", nil, 200)["team"].(map[string]any)["id"]
	owner.call("POST", "/api/v1/auth/team", map[string]any{"team_id": team}, 200)
	owner.call("DELETE", path+"/share", nil, 200)
	guest.call("GET", link, nil, 404)
	share = owner.call("POST", path+"/share", in, 201)
	link = "/api/v1/assistant/shares/" + share["id"].(string)
	owner.call("PATCH", path, map[string]any{"action": "delete", "expected_revision": c["revision"]}, 200)
	owner.call("PATCH", path, map[string]any{"action": "restore", "expected_revision": c["revision"].(float64) + 1}, 200)
	guest.call("GET", link, nil, 404)
	settings["revision"] = saved["revision"]
	settings["model_retries"] = 0
	owner.call("PATCH", "/api/v1/assistant/behavior", settings, 200)
	before := count
	owner.call("POST", "/api/v1/assistant/chat", map[string]any{"request_id": store.ID(), "config_id": config, "message": "Synthetic second chat"}, 200)
	if count != before+1 {
		t.Fatal("unexpected repeat")
	}
}
