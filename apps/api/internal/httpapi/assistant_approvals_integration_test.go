package httpapi

import (
	"testing"

	"coflow/api/internal/store"
)

func TestAssistantReadOnlyReturnsEmptyActions(t *testing.T) {
	owner, _, _ := assistantFixture(t, "read_workspace", nil)
	config := configureAI(owner, "personal")
	input := map[string]any{"request_id": store.ID(), "config_id": config, "message": "Read workspace"}
	for i := 0; i < 2; i++ {
		out := owner.call("POST", "/api/v1/assistant/chat", input, 200)
		actions, ok := out["turn"].(map[string]any)["actions"].([]any)
		if !ok || len(actions) != 0 {
			t.Fatal("read-only response must return an empty actions array", out)
		}
		input["conversation_id"] = out["conversation_id"]
	}
}

func TestAssistantRememberedApprovals(t *testing.T) {
	owner, guest, _ := assistantFixture(t, "propose_todo", map[string]any{
		"title": "Synthetic task", "column_id": "backlog", "project_id": "general",
	})
	config := configureAI(owner, "personal")
	chat := func(conversation string) (string, map[string]any) {
		t.Helper()
		out := owner.call("POST", "/api/v1/assistant/chat", map[string]any{
			"request_id": store.ID(), "config_id": config, "message": "Prepare a synthetic task", "conversation_id": conversation,
		}, 200)
		return out["conversation_id"].(string), out["turn"].(map[string]any)["actions"].([]any)[0].(map[string]any)
	}
	decide := func(client *authClient, a map[string]any, decision string, status int) map[string]any {
		t.Helper()
		return client.call("POST", "/api/v1/assistant/actions/"+a["id"].(string), map[string]any{"decision": decision}, status)
	}
	first, action := chat("")
	if action["state"] != "pending" {
		t.Fatal("first action must require approval")
	}
	_, older := chat(first)
	decide(guest, action, "allow-session", 404)
	if v := decide(owner, action, "allow-session", 200); v["state"] != "done" {
		t.Fatal("initial action did not execute")
	}
	_, auto := chat(first)
	if auto["state"] != "done" || auto["result"].(map[string]any)["approval_mode"] != "saved" {
		t.Fatal("next eligible action in the same conversation did not execute", auto)
	}
	row := owner.call("GET", "/api/v1/assistant/conversations/"+first, nil, 200)
	for _, round := range row["turns"].([]any) {
		v := round.(map[string]any)["actions"].([]any)[0].(map[string]any)
		if v["id"] == older["id"] && v["state"] != "pending" {
			t.Fatal("an older draft was auto-approved")
		}
	}
	_, other := chat("")
	if other["state"] != "pending" {
		t.Fatal("session approval escaped the conversation")
	}
	decide(owner, other, "always-allow", 200)
	_, always := chat("")
	if always["state"] != "done" {
		t.Fatal("workspace approval was not applied")
	}
	if rows := guest.call("GET", "/api/v1/assistant/approvals", nil, 200)["items"].([]any); len(rows) != 0 {
		t.Fatal("another member can see the approvals")
	}
	for _, raw := range owner.call("GET", "/api/v1/assistant/approvals", nil, 200)["items"].([]any) {
		owner.call("DELETE", "/api/v1/assistant/approvals", raw, 200)
	}
	_, pending := chat(first)
	if pending["state"] != "pending" {
		t.Fatal("revoked approval executed a draft")
	}
}
