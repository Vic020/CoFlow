package httpapi

import (
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"coflow/api/internal/workspace"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type modelTransport func(*http.Request) (*http.Response, error)

func (f modelTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func fakeModel(name string, args map[string]any) *http.Client {
	return &http.Client{Transport: modelTransport(func(r *http.Request) (*http.Response, error) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		messages := body["messages"].([]any)
		last := messages[len(messages)-1].(map[string]any)
		v := map[string]any{"role": "assistant", "content": "Draft prepared; confirm to execute."}
		if len(messages) == 1 {
			v["content"] = "OK"
		} else if last["role"] != "tool" {
			raw, _ := json.Marshal(args)
			delete(v, "content")
			v["tool_calls"] = []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": name, "arguments": string(raw)}}}
		}
		if body["stream"] == true {
			delta := map[string]any{}
			finish := "stop"
			if text, ok := v["content"].(string); ok {
				delta["content"] = text
			}
			if calls, ok := v["tool_calls"].([]any); ok {
				for i, c := range calls {
					c.(map[string]any)["index"] = i
				}
				delta["tool_calls"] = calls
				finish = "tool_calls"
			}
			a, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta}}})
			b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": finish}}})
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader("data: " + string(a) + "\n\ndata: " + string(b) + "\n\ndata: [DONE]\n\n"))}, nil
		}
		raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": v}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})}
}
func assistantFixture(t *testing.T, name string, args map[string]any) (*authClient, *authClient, *store.Postgres) {
	repo, svc := identityFixture(t)
	h := NewWithConfig(repo, Config{Identity: svc, BootstrapToken: testBootstrapToken, AIEncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), AIClient: fakeModel(name, args)})
	owner := &authClient{t: t, h: h}
	owner.call("POST", "/api/v1/auth/bootstrap", map[string]any{"email": "assistant-owner@example.test", "name": "Owner", "password": "synthetic-password-123", "team_name": "Assistant QA"}, 201)
	invite := owner.call("POST", "/api/v1/invites", map[string]any{"email": "assistant-guest@example.test"}, 201)
	guest := &authClient{t: t, h: h}
	guest.call("POST", "/api/v1/auth/accept-invite", map[string]any{"token": invite["token"], "name": "Guest", "password": "synthetic-password-123"}, 200)
	return owner, guest, repo
}
func configureAI(c *authClient, scope string) string {
	v := c.call("POST", "/api/v1/assistant/configs", map[string]any{"scope": scope, "name": "QA model", "provider": "compatible", "protocol": "chat-completions", "base_url": "https://models.example.test/v1", "model": "test-model", "api_key": "synthetic-qa-key", "is_default": true}, 200)
	id := v["id"].(string)
	c.call("POST", "/api/v1/assistant/configs/"+id+"/verify", nil, 200)
	return id
}
func proposal(c *authClient, config string) map[string]any {
	return c.call("POST", "/api/v1/assistant/chat", map[string]any{"request_id": "qa-" + store.ID(), "config_id": config, "message": "Prepare the requested change", "locale": "en", "context": map[string]any{"timezone": "Asia/Shanghai"}}, 200)
}
func TestAssistantConfigIsolationAndConfirmation(t *testing.T) {
	owner, guest, repo := assistantFixture(t, "propose_todo", map[string]any{"title": "Synthetic delivery task", "column_id": "backlog"})
	anon := &authClient{t: t, h: owner.h}
	anon.call("GET", "/api/v1/assistant/configs", nil, 401)
	config := configureAI(owner, "personal")
	if len(guest.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("personal key visible to teammate")
	}
	guest.call("POST", "/api/v1/assistant/configs", map[string]any{"scope": "team"}, 403)
	raw, _ := json.Marshal(owner.call("GET", "/api/v1/assistant/configs", nil, 200))
	if strings.Contains(string(raw), "synthetic-qa-key") || strings.Contains(string(raw), "secret") {
		t.Fatal("secret metadata leaked")
	}
	var secret []byte
	if e := repo.Pool().QueryRow(t.Context(), "SELECT secret FROM assistant_configs WHERE id=$1", config).Scan(&secret); e != nil || strings.Contains(string(secret), "synthetic-qa-key") {
		t.Fatal("secret not encrypted")
	}
	token := owner.call("POST", "/api/v1/tokens", map[string]any{"name": "Agent QA", "scopes": []string{"reports:read", "reports:write", "todos:read", "todos:write"}, "expires_in_days": 1}, 201)["credential"].(string)
	agent := &authClient{t: t, h: owner.h, token: token}
	agent.call("GET", "/api/v1/assistant/configs", nil, 403)
	result := proposal(owner, config)
	conv := result["conversation_id"].(string)
	aid := result["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"].(string)
	if len(owner.call("GET", "/api/v1/todos", nil, 200)["items"].([]any)) != 0 {
		t.Fatal("proposal executed without confirmation")
	}
	guest.call("GET", "/api/v1/assistant/conversations/"+conv, nil, 404)
	guest.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 404)
	done := owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 200)
	if done["state"] != "done" {
		t.Fatal("confirmation did not execute")
	}
	again := owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 200)
	if done["result"].(map[string]any)["id"] != again["result"].(map[string]any)["id"] {
		t.Fatal("confirmation not idempotent")
	}
	if len(owner.call("GET", "/api/v1/todos", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("duplicate task")
	}
	read := owner.call("GET", "/api/v1/assistant/conversations/"+conv, nil, 200)
	if read["turns"].([]any)[0].(map[string]any)["actions"].([]any)[0].(map[string]any)["state"] != "done" {
		t.Fatal("history has stale action state")
	}
	owner.call("POST", "/api/v1/teams", map[string]any{"name": "Another QA team", "display_name": "Owner"}, 201)
	owner.call("GET", "/api/v1/assistant/conversations/"+conv, nil, 404)
	if items := owner.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != config {
		t.Fatal("account config lost across workspaces")
	}
}
func TestAssistantReportDraftAndCancellation(t *testing.T) {
	owner, _, _ := assistantFixture(t, "propose_report", map[string]any{"title": "Initial draft", "body": "Synthetic evidence only."})
	config := configureAI(owner, "team")
	result := proposal(owner, config)
	aid := result["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"].(string)
	owner.call("PATCH", "/api/v1/assistant/actions/"+aid, map[string]any{"title": "Reviewed draft", "body": "Human-reviewed synthetic evidence."}, 200)
	done := owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 200)
	if done["state"] != "done" || done["result"].(map[string]any)["title"] != "Reviewed draft" {
		t.Fatal("edited draft lost")
	}
	history := owner.call("GET", "/api/v1/assistant/conversations/"+result["conversation_id"].(string), nil, 200)
	if history["turns"].([]any)[0].(map[string]any)["actions"].([]any)[0].(map[string]any)["title"] != "Reviewed draft" {
		t.Fatal("draft edits lost after history read")
	}
	owner.call("PATCH", "/api/v1/assistant/actions/"+aid, map[string]any{"title": "overwrite", "body": "no"}, 409)
	result = proposal(owner, config)
	aid = result["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"].(string)
	owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "cancel"}, 200)
	v := owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 200)
	if v["state"] != "cancelled" {
		t.Fatal("cancelled action executed")
	}
	if len(owner.call("GET", "/api/v1/reports", nil, 200)["items"].([]any)) != 1 {
		t.Fatal("cancelled report persisted")
	}
}
func TestAssistantScheduleConflict(t *testing.T) {
	args := map[string]any{}
	owner, _, _ := assistantFixture(t, "propose_schedule", args)
	config := configureAI(owner, "personal")
	todo := owner.call("POST", "/api/v1/todos", map[string]any{"title": "QA scheduling", "column_id": "backlog", "source_id": "qa-schedule", "operation_id": "qa-create", "due_date": "2026-11-15"}, 200)
	args["todo_id"] = todo["id"]
	args["expected_revision"] = todo["revision"]
	args["schedule"] = map[string]any{"kind": "date-range", "start_date": "2026-11-09", "end_date": "2026-11-13"}
	r := proposal(owner, config)
	aid := r["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"].(string)
	owner.call("PATCH", "/api/v1/todos/"+todo["id"].(string), map[string]any{"action": "edit", "title": "Human changed it", "expected_revision": todo["revision"], "operation_id": "human-edit"}, 200)
	v := owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 200)
	if v["state"] != "failed" {
		t.Fatal("stale schedule overwritten human change")
	}
	fresh := owner.call("GET", "/api/v1/todos/"+todo["id"].(string), nil, 200)
	if fresh["title"] != "Human changed it" || fresh["schedule"] != nil || fresh["due_date"] != "2026-11-15" {
		t.Fatal("unrelated fields changed")
	}
}

func TestAssistantScheduleReplayAfterInterruptedConfirmation(t *testing.T) {
	args := map[string]any{}
	owner, _, repo := assistantFixture(t, "propose_schedule", args)
	config := configureAI(owner, "personal")
	todo := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Replay schedule", "column_id": "backlog", "source_id": "qa-replay", "operation_id": "qa-replay-create", "due_date": "2026-11-20"}, 200)
	args["todo_id"] = todo["id"]
	args["expected_revision"] = todo["revision"]
	args["schedule"] = &workspace.Schedule{Kind: "date-range", StartDate: "2026-11-09", EndDate: "2026-11-13"}
	r := proposal(owner, config)
	aid := r["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"].(string)
	// Simulate a process stopping after the business transaction committed but before saving action completion.
	p, e := identity.New(repo.Pool()).Authenticate(t.Context(), owner.cookie.Value, false)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(map[string]any{"action": "edit", "schedule": args["schedule"], "expected_revision": todo["revision"], "operation_id": "assistant:" + aid, "agent": "CoFlow Assistant"})
	var in workspace.TodoInput
	if e = json.Unmarshal(raw, &in); e != nil {
		t.Fatal(e)
	}
	ws := &workspace.Service{Pool: repo.Pool()}
	first, e := ws.ChangeTodo(t.Context(), p, todo["id"].(string), in)
	if e != nil {
		t.Fatal(e)
	}
	result := owner.call("POST", "/api/v1/assistant/actions/"+aid, map[string]any{"decision": "confirm"}, 200)
	if result["state"] != "done" {
		t.Fatal("recovery must replay prior operation instead of failing on its old revision")
	}
	fresh := owner.call("GET", "/api/v1/todos/"+first.ID, nil, 200)
	if fresh["revision"] != float64(first.Revision) || fresh["due_date"] != "2026-11-20" || fresh["completed_at"] != nil {
		t.Fatal("recovery changed unrelated state or repeated edit")
	}
}
func TestAssistantChatRetryAndSharedSettings(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "propose_todo", map[string]any{"title": "Only one draft", "column_id": "backlog"})
	config := configureAI(owner, "team")
	items := guest.call("GET", "/api/v1/assistant/configs", nil, 200)["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["editable"] != false {
		t.Fatal("shared configuration metadata access incorrect")
	}
	guest.call("POST", "/api/v1/assistant/configs/"+config+"/verify", nil, 403)
	owner.call("PATCH", "/api/v1/assistant/preference", map[string]any{"config_id": config}, 200)
	if owner.call("GET", "/api/v1/assistant/configs", nil, 200)["selected_config_id"] != config {
		t.Fatal("selection did not persist")
	}
	input := map[string]any{"request_id": "stable-first-turn", "config_id": config, "message": "Prepare one task"}
	a := owner.call("POST", "/api/v1/assistant/chat", input, 200)
	b := owner.call("POST", "/api/v1/assistant/chat", input, 200)
	if a["conversation_id"] != b["conversation_id"] {
		t.Fatal("uncertain first response produced a duplicate conversation")
	}
	ac := a["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"]
	bc := b["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)["id"]
	if ac != bc {
		t.Fatal("duplicate confirmation draft")
	}
}
