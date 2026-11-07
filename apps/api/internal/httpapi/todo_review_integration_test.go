package httpapi

import (
	"coflow/api/internal/store"
	"testing"
)

func TestTodoAcceptanceLifecycleAndBypassGuards(t *testing.T) {
	owner, reviewer, _ := assistantFixture(t, "read_workspace", nil)
	rid := reviewer.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"].(string)
	token := func(c *authClient, scopes ...string) *authClient {
		return &authClient{t: t, h: c.h, token: c.call("POST", "/api/v1/tokens", map[string]any{"name": "Synthetic reviewer", "scopes": scopes}, 201)["credential"].(string)}
	}
	read := token(reviewer, "todos:read")
	write := token(reviewer, "todos:read", "todos:write")
	task := owner.call("POST", "/api/v1/todos", map[string]any{"source_id": "reviewed-task", "operation_id": store.ID(), "title": "Acceptance QA", "column_id": "backlog", "review": map[string]any{"criteria": "Tests pass and delivery is reviewed", "reviewer_id": rid, "state": "approved", "decision_by": rid, "evidence": "forged"}}, 200)
	id := task["id"].(string)
	if task["review"].(map[string]any)["state"] != "draft" {
		t.Fatal("client forged approval")
	}
	change := func(c *authClient, action, body string, status int) map[string]any {
		latest := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
		b := owner.call("GET", "/api/v1/todo-board", nil, 200)
		return c.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": action, "body": body, "expected_revision": latest["revision"], "board_revision": b["revision"], "operation_id": store.ID()}, status)
	}
	change(owner, "complete", "", 400)
	change(owner, "submit-review", "", 400)
	task = change(owner, "submit-review", "PR and tests ready for acceptance", 200)
	if task["completed_at"] != nil || task["review"].(map[string]any)["state"] != "pending" {
		t.Fatal("submission falsely completed task")
	}
	if int(task["review"].(map[string]any)["submitted_revision"].(float64)) != int(task["revision"].(float64)) {
		t.Fatal("submission revision missing")
	}
	related := read.call("GET", "/api/v1/todos?scope=todo", nil, 200)["items"].([]any)
	if len(related) != 1 || related[0].(map[string]any)["id"] != id {
		t.Fatal("reviewer pending work missing")
	}
	// Owner/admin cannot impersonate the designated reviewer. Read-only token cannot decide.
	change(owner, "approve-review", "", 403)
	change(read, "approve-review", "", 403)
	owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "edit", "review": nil, "expected_revision": task["revision"], "operation_id": store.ID()}, 400)
	b := owner.call("GET", "/api/v1/todo-board", nil, 200)
	owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "move", "column_id": "done", "expected_revision": task["revision"], "board_revision": b["revision"], "operation_id": store.ID()}, 400)
	// A joint report/move must roll back, including report creation.
	before := owner.call("GET", "/api/v1/reports", nil, 200)
	owner.call("POST", "/api/v1/reports", map[string]any{"source_id": "cannot-bypass-review", "title": "Delivered is not accepted", "body": "Evidence", "status": "delivered", "todo_ids": []string{id}, "todo_moves": []any{map[string]any{"id": id, "column_id": "done", "expected_revision": task["revision"]}}, "operation_id": store.ID()}, 400)
	after := owner.call("GET", "/api/v1/reports", nil, 200)
	if len(after["items"].([]any)) != len(before["items"].([]any)) {
		t.Fatal("joint report was partially committed")
	}
	col := b["columns"].([]any)[0].(map[string]any)
	owner.call("PATCH", "/api/v1/todo-columns/"+col["id"].(string), map[string]any{"name": col["name"], "done": true, "action": "edit", "board_revision": b["revision"], "expected_revision": col["revision"], "operation_id": store.ID()}, 400)
	change(write, "request-changes", "", 400)
	task = change(write, "request-changes", "Add regression evidence", 200)
	if task["review"].(map[string]any)["state"] != "changes_requested" {
		t.Fatal("return decision lost")
	}
	task = change(owner, "submit-review", "Updated regression evidence", 200)
	stale := task["revision"]
	task = owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "edit", "body": "Material change after submission", "expected_revision": stale, "operation_id": store.ID()}, 200)
	if task["review"].(map[string]any)["state"] != "draft" {
		t.Fatal("stale review not invalidated")
	}
	write.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "approve-review", "expected_revision": stale, "board_revision": b["revision"], "operation_id": store.ID()}, 409)
	change(write, "approve-review", "", 400)
	task = change(owner, "submit-review", "Final evidence reviewed", 200)
	b = owner.call("GET", "/api/v1/todo-board", nil, 200)
	accept := map[string]any{"action": "approve-review", "body": "Acceptance criteria satisfied", "expected_revision": task["revision"], "board_revision": b["revision"], "operation_id": store.ID()}
	task = write.call("PATCH", "/api/v1/todos/"+id, accept, 200)
	again := write.call("PATCH", "/api/v1/todos/"+id, accept, 200)
	if again["revision"] != task["revision"] || task["completed_at"] == nil || task["review"].(map[string]any)["decision_by"] != rid {
		t.Fatal("acceptance/replay failed")
	}
	history := task["history"].([]any)
	last := history[len(history)-1].(map[string]any)
	if last["before"].(map[string]any)["review"].(map[string]any)["state"] != "pending" {
		t.Fatal("before snapshot was mutated")
	}
	owner.call("PATCH", "/api/v1/todos/"+id, map[string]any{"action": "edit", "title": "Cannot silently change accepted work", "expected_revision": task["revision"], "operation_id": store.ID()}, 400)
	task = change(owner, "reopen", "", 200)
	if task["completed_at"] != nil || task["review"].(map[string]any)["state"] != "draft" {
		t.Fatal("reopen retained old approval")
	}
}

func TestAssistantCanSubmitButCannotApproveReview(t *testing.T) {
	args := map[string]any{"change_action": "submit-review", "body": "Synthetic delivery evidence"}
	owner, _, _ := assistantFixture(t, "propose_task_change", args)
	uid := owner.call("GET", "/api/v1/auth/me", nil, 200)["user"].(map[string]any)["id"]
	task := owner.call("POST", "/api/v1/todos", map[string]any{"title": "Assistant review QA", "column_id": "backlog", "source_id": "assistant-review", "operation_id": store.ID(), "review": map[string]any{"criteria": "Human accepts the evidence", "reviewer_id": uid}}, 200)
	id := task["id"].(string)
	args["todo_id"] = id
	args["expected_revision"] = task["revision"]
	config := configureAI(owner, "personal")
	result := proposal(owner, config)
	cards := result["turn"].(map[string]any)["actions"].([]any)
	if len(cards) != 1 {
		t.Fatal("submission proposal missing")
	}
	owner.call("POST", "/api/v1/assistant/actions/"+cards[0].(map[string]any)["id"].(string), map[string]any{"decision": "confirm"}, 200)
	task = owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	if task["review"].(map[string]any)["state"] != "pending" || task["completed_at"] != nil {
		t.Fatal("submission acted as acceptance")
	}
	// Even when the model ignores its tool schema and the caller is the reviewer, it cannot propose approval.
	args["expected_revision"] = task["revision"]
	args["change_action"] = "approve-review"
	result = proposal(owner, config)
	if len(result["turn"].(map[string]any)["actions"].([]any)) != 0 {
		t.Fatal("model prepared an acceptance decision")
	}
	fresh := owner.call("GET", "/api/v1/todos/"+id, nil, 200)
	if fresh["review"].(map[string]any)["state"] != "pending" || fresh["completed_at"] != nil {
		t.Fatal("model approved review")
	}
}
